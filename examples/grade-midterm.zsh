#!/usr/bin/env zsh
# Offline, instructor-only grading. Never run student code on the class server.
emulate -R zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077
export LC_ALL=C

die() { print -ru2 -- "$*"; exit 1; }
usage() {
    print -ru2 -- "Usage:
  $0 run CLASS_SSH_HOST NEW_OUTPUT_DIRECTORY
  $0 cleanup OUTPUT_DIRECTORY

Grades the latest started midterm/midterm-recovery attempt per student, including
both rosters and historical attempt owners. No submission => 0 (instructor policy).
Export, incomplete/ambiguous latest work and grading failures => blank + errors.tsv,
exit 1. Success => grades.csv with USERNAME,GRADE, points out of 100.
Does not collect live work, grant attempts, change clocks or write student records.
Keep grading-extract.py beside this script. Docker must already have the pinned
compiler image; no image pulls/package installs occur. Run on an instructor's
Docker machine, with SSH/sudo access for protected exports on the class server."
    exit ${1:-2}
}
(( $# >= 1 )) || usage
[[ $1 != --help && $1 != -h ]] || usage 0
mode=$1
case $mode in
    run) (( $# == 3 )) || usage; class_host=$2; run_dir=${3:A} ;;
    cleanup) (( $# == 2 )) || usage; run_dir=${2:A} ;;
    *) usage ;;
esac
[[ $run_dir != *','* && $run_dir != *$'\n'* ]] || die 'Output path cannot contain commas or newlines'
docker_bin=${EXAM_GRADE_DOCKER_BIN:-docker}
timeout_bin=${EXAM_GRADE_TIMEOUT_BIN:-timeout}
for executable in "$docker_bin" "$timeout_bin"; do
    command -v -- "$executable" >/dev/null || die "Required executable unavailable: $executable; check PATH/install its package"
done
# Bind mounts refer to this controller's files: never inherit a remote Docker
# context/DOCKER_HOST (which might point at the live exam server).
docker_endpoint=${EXAM_GRADE_DOCKER_HOST:-unix:///var/run/docker.sock}
if [[ $mode == cleanup && -f $run_dir/docker-endpoint.txt ]]; then
    docker_endpoint=$(< "$run_dir/docker-endpoint.txt")
fi
[[ $docker_endpoint == unix:///* && -S ${docker_endpoint#unix://} ]] ||
    die 'A local Docker Unix socket is required; start the local engine or set EXAM_GRADE_DOCKER_HOST'
dk() { "$timeout_bin" --kill-after=5 20 "$docker_bin" --host "$docker_endpoint" "$@"; }
run_id=''
active_name=''
active_job=''

# Remove only an exact owned grading container. Engine errors are not absence.
cleanup_one() {
    typeset name=$1 job=$2 found=''
    if found=$(dk container inspect --format '{{ index .Config.Labels "ssh-exam.offline-run" }}' "$name" 2> "$job/cleanup-error.txt"); then
        [[ $found == "$run_id" ]] || { print -ru2 -- "Foreign container: $name"; return 1; }
        dk container rm --force "$name" > "$job/cleanup-engine.txt" 2>&1 || return 1
    else
        found=$(< "$job/cleanup-error.txt")
        [[ ${(L)found} == *'no such'* ]] || return 1
    fi
    if dk container inspect "$name" > /dev/null 2> "$job/cleanup-error.txt"; then
        return 1
    fi
    found=$(< "$job/cleanup-error.txt")
    [[ ${(L)found} == *'no such'* ]] || return 1
    print -r -- 'owned container absent' > "$job/cleanup.receipt"
}

if [[ $mode == cleanup ]]; then
    [[ -d $run_dir && ! -L $run_dir && -f $run_dir/run-id ]] || die 'Not a grading run directory'
    run_id=$(< "$run_dir/run-id")
    [[ $run_id =~ '^[a-f0-9]{32}$' ]] || die 'Invalid grading run identity'
    print -r -- 'Cancelled; preserve results and use a new run directory' > "$run_dir/cancelled"
    for job in "$run_dir"/jobs/*(N/); do
        [[ -f $job/container.name ]] || continue
        name=$(< "$job/container.name")
        [[ $name == exam-grade-${run_id}-* && $name =~ '^[a-zA-Z0-9_-]+$' ]] || die 'Invalid owned container name'
        cleanup_one "$name" "$job" || die "Cleanup unconfirmed: $name; preserve this directory"
    done
    print -r -- 'Owned grading containers absent; archives and reports preserved.'
    exit 0
fi

[[ $class_host =~ '^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$' ]] || die 'Choose a configured SSH alias/user@host'
ssh_bin=${EXAM_GRADE_SSH_BIN:-ssh}
for executable in "$ssh_bin" python3 sha256sum head mkdir chmod mv wc; do
    command -v -- "$executable" >/dev/null || die "Required executable unavailable: $executable; check PATH/install its package"
done
extractor=${0:A:h}/grading-extract.py
[[ -f $extractor && ! -L $extractor ]] || die 'Keep grading-extract.py beside this script'
image=${EXAM_GRADE_IMAGE:-golang:1.27.2-bookworm@sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad}
[[ $image == *@sha256:* || $image == sha256:* ]] || die 'Use an explicitly digest-pinned grading image'
seconds=${EXAM_GRADE_SECONDS:-300}
[[ $seconds == <-> && ${#seconds} -le 4 ]] && (( seconds >= 1 && seconds <= 3600 )) || die 'Grading timeout must be 1..3600 seconds'
materials_source=${EXAM_GRADE_MATERIALS:-/var/lib/exam-agent/templates/sys1-midterm-a/materials}
[[ $materials_source == /* ]] || die 'Authored materials path must be absolute on the class server'
grader_hash=${EXAM_GRADE_GRADER_SHA256:-8b90975bebbe6165cbf7c886c85d029109038201114ce8be3eca9456a98a7d50}
[[ $grader_hash =~ '^[a-f0-9]{64}$' ]] || die 'Expected grader SHA256 must have 64 lowercase hex digits'

mkdir -m 700 -- "$run_dir"
mkdir -m 700 -- "$run_dir/jobs" "$run_dir/materials"
run_id=$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
print -r -- "$run_id" > "$run_dir/run-id"
print -r -- "$docker_endpoint" > "$run_dir/docker-endpoint.txt"
trap 'if [[ -n $active_name ]]; then cleanup_one "$active_name" "$active_job" || print -ru2 -- "Cleanup unconfirmed; run cleanup on $run_dir"; fi' EXIT
trap 'print -r -- "Cancelled by INT" > "$run_dir/cancelled"; exit 130' INT
trap 'print -r -- "Cancelled by TERM" > "$run_dir/cancelled"; exit 143' TERM

ssh_read() {
    typeset -a quoted=()
    typeset word
    for word in "$@"; do quoted+=("${(qq)word}"); done
    "$ssh_bin" -o BatchMode=yes -o ConnectTimeout=15 "$class_host" "${(j: :)quoted}"
}
ec() { ssh_read sudo -n /usr/local/sbin/examctl "$@"; }
image_id=$(dk image inspect --format '{{.Id}}' "$image") || die 'Pinned grading image is unavailable; load the qualified image explicitly'
architecture=$(dk image inspect --format '{{.Architecture}} {{.Os}}' "$image_id")
[[ $architecture == 'amd64 linux' ]] || die 'This supplied grader requires a Linux amd64 compiler image'

for exam in midterm midterm-recovery; do
    ec web students list "$exam" --all --format tsv --fields username --no-header > "$run_dir/$exam-roster.tsv"
done
ec web attempts list --exam midterm --exam midterm-recovery --all --format tsv \
    --fields username,exam,start,id,checksum,protected,state --no-header > "$run_dir/attempts.tsv"

typeset -A known=() newest=() attempts=() checksums=() protected=() states=() ties=()
typeset -a students=() columns=()
student='' record=''
for exam in midterm midterm-recovery; do
    while IFS= read -r student || [[ -n $student ]]; do
        [[ $student =~ '^[a-zA-Z][a-zA-Z0-9_-]{0,31}$' ]] || die 'Invalid roster username'
        known[$student]=1
    done < "$run_dir/$exam-roster.tsv"
done
while IFS= read -r record || [[ -n $record ]]; do
    columns=("${(@ps:\t:)record}")
    (( ${#columns} == 7 )) || die 'Malformed attempt export'
    student=$columns[1]
    [[ $student =~ '^[a-zA-Z][a-zA-Z0-9_-]{0,31}$' ]] || die 'Invalid attempt owner'
    [[ $columns[2] == midterm || $columns[2] == midterm-recovery ]] || die 'Wrong exam in export'
    known[$student]=1
    started=$columns[3]
    [[ -n $started ]] || continue
    [[ $started == <-> && ${#started} -le 16 ]] || die 'Invalid attempt start time'
    epoch=$(( 10#$started ))
    (( epoch > 0 )) || continue
    if (( ! ${+newest[$student]} || epoch > ${newest[$student]:-0} )); then
        newest[$student]=$epoch
        attempts[$student]=$columns[4]
        checksums[$student]=$columns[5]
        protected[$student]=$columns[6]
        states[$student]=$columns[7]
        ties[$student]=0
    elif (( epoch == ${newest[$student]} )) && [[ $columns[4] != "${attempts[$student]}" || $columns[5] != "${checksums[$student]}" ]]; then
        ties[$student]=1
    fi
done < "$run_dir/attempts.tsv"
students=("${(@ok)known}")

# Fetch only trusted authored materials. Student-modified graders/Makefiles are
# never invoked. The input archive and grader are mounted read-only per student.
ssh_read sudo -n tar -C "$materials_source" -czf - -- grade scoring.tsv include tests > "$run_dir/materials.tar.gz"
python3 "$extractor" materials "$run_dir/materials.tar.gz" "$run_dir/materials"
digest=$(sha256sum -- "$run_dir/materials/grade"); digest=${digest%% *}
[[ $digest == "$grader_hash" ]] || die 'Authored grader changed; inspect and explicitly select its SHA256 before grading'
sha256sum -- "$run_dir/materials.tar.gz" > "$run_dir/materials.sha256"
print -r -- "$image_id" > "$run_dir/grading-image.txt"
print -r -- 'USERNAME,GRADE' > "$run_dir/.grades.partial"
print -r -- $'USERNAME\tREASON' > "$run_dir/errors.tsv"
print -r -- $'USERNAME\tATTEMPT\tCHECKSUM\tRESULT' > "$run_dir/selections.tsv"
typeset -i failures=0
record_error() {
    print -r -- "$student," >> "$run_dir/.grades.partial"
    print -r -- "$student"$'\t'"$1" >> "$run_dir/errors.tsv"
    print -r -- "$student"$'\t'"${attempts[$student]:-}"$'\t'"${checksums[$student]:-}"$'\t'"$1" >> "$run_dir/selections.tsv"
    (( ++failures ))
}

for student in "${students[@]}"; do
    [[ ! -e $run_dir/cancelled ]] || die 'Grading cancelled; partial results preserved'
    if (( ! ${+newest[$student]} )); then
        print -r -- "$student,0" >> "$run_dir/.grades.partial"
        print -r -- "$student"$'\t\t\tNO_SUBMISSION_ZERO' >> "$run_dir/selections.tsv"
        continue
    fi
    (( ${ties[$student]} == 0 )) || { record_error AMBIGUOUS_LATEST; continue; }
    [[ ${states[$student]} == COMPLETED && (${protected[$student]} == 1 || ${protected[$student]} == true) ]] || { record_error LATEST_NOT_PROTECTED; continue; }
    attempt=${attempts[$student]}
    checksum=${checksums[$student]}
    [[ $attempt =~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' && $checksum =~ '^[a-f0-9]{64}$' ]] || { record_error INVALID_LATEST_IDENTITY; continue; }
    job=$run_dir/jobs/$student
    mkdir -m 700 -- "$job"
    if ! ec export "$attempt" > "$job/submission.tar.gz" 2> "$job/export-error.txt"; then
        record_error EXPORT_FAILED; continue
    fi
    digest=$(sha256sum -- "$job/submission.tar.gz"); digest=${digest%% *}
    [[ $digest == "$checksum" ]] || { record_error CHECKSUM_MISMATCH; continue; }
    chmod 444 -- "$job/submission.tar.gz"
    active_name=exam-grade-${run_id}-${student}
    active_job=$job
    print -r -- "$active_name" > "$job/container.name"
    if ! dk container create --name "$active_name" --label "ssh-exam.offline-run=$run_id" \
        --pull never --init --network none --read-only --cap-drop ALL \
        --security-opt no-new-privileges --user 65534:65534 \
        --memory 1g --memory-swap 1g --cpus 1 --pids-limit 128 \
        --ulimit core=0 --ulimit nofile=1024:1024 --restart no --log-driver none \
        --tmpfs /work:rw,nosuid,nodev,size=640m,mode=0700,uid=65534,gid=65534 \
        --tmpfs /tmp:rw,nosuid,nodev,exec,size=256m,mode=1777 \
        --mount "type=bind,src=$job/submission.tar.gz,dst=/input/submission.tar.gz,readonly" \
        --mount "type=bind,src=$run_dir/materials,dst=/materials,readonly" \
        --mount "type=bind,src=$extractor,dst=/grading-extract.py,readonly" \
        --env LC_ALL=C --env HOME=/tmp --env TMPDIR=/tmp \
        --env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        --workdir /work --entrypoint /usr/bin/timeout "$image_id" \
        --kill-after=5 "$seconds" /bin/sh -c \
        'for n in python3 gcc nm awk grep timeout; do command -v "$n" >/dev/null || exit 70; done; python3 /grading-extract.py submission /input/submission.tar.gz /work && exec /materials/grade --work /work' \
        > "$job/container.id" 2> "$job/create-error.txt"; then
        cleanup_one "$active_name" "$job" || die 'Container creation/cleanup unconfirmed; preserve run and use cleanup'
        active_name=''; record_error CONTAINER_CREATE_FAILED; continue
    fi
    if [[ -e $run_dir/cancelled ]]; then
        cleanup_one "$active_name" "$job" || die 'Cancelled grading cleanup unconfirmed'
        active_name=''; die 'Grading cancelled before execution; partial results preserved'
    fi
    attach_ok=true
    if ! "$timeout_bin" --kill-after=5 $((seconds + 30)) "$docker_bin" --host "$docker_endpoint" container start --attach "$active_name" 2>&1 | head -c 1048576 > "$job/grader.log"; then
        attach_ok=false
    fi
    engine_state=$(dk container inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$active_name") || die 'Grading state unavailable; preserve run and use cleanup'
    print -r -- "$engine_state" > "$job/engine-state.txt"
    cleanup_one "$active_name" "$job" || die 'Grading cleanup unconfirmed; preserve run and use cleanup'
    active_name=''
    [[ ! -e $run_dir/cancelled ]] || die 'Grading cancelled; partial results preserved'
    if [[ $attach_ok != true || $engine_state != 'exited 0 false' ]]; then
        record_error GRADER_FAILED; continue
    fi
    (( $(wc -c < "$job/grader.log") < 1048576 )) || { record_error OUTPUT_LIMIT; continue; }
    typeset -i totals=0
    earned='' possible=''
    while IFS= read -r record || [[ -n $record ]]; do
        if [[ $record =~ '^TOTAL: ([0-9]+)/([0-9]+)$' ]]; then
            (( ++totals )); earned=$match[1]; possible=$match[2]
        fi
    done < "$job/grader.log"
    if (( totals != 1 )) || [[ ${#earned} -gt 3 || $possible != 100 ]] || (( 10#${earned:-999} > 100 )); then
        record_error INVALID_GRADER_TOTAL; continue
    fi
    print -r -- "$student,$((10#$earned))" >> "$run_dir/.grades.partial"
    print -r -- "$student"$'\t'"$attempt"$'\t'"$checksum"$'\tGRADED' >> "$run_dir/selections.tsv"
done
[[ ! -e $run_dir/cancelled ]] || die 'Grading cancelled; partial results preserved'
mv -n -- "$run_dir/.grades.partial" "$run_dir/grades.csv"
[[ ! -e $run_dir/.grades.partial ]] || die 'CSV destination already exists; no result overwritten'
print -r -- "CSV: $run_dir/grades.csv; errors: $run_dir/errors.tsv"
(( failures == 0 )) || exit 1
