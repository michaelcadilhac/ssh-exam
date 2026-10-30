#!/usr/bin/env zsh
# Instructor-only grading with lightweight, bounded bwrap sandboxes.
emulate -R zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077
export LC_ALL=C
script_name=$0

die() { print -ru2 -- "$*"; exit 1; }
usage() {
    print -ru2 -- "Usage:
  $script_name run CLASS_SSH_HOST NEW_OUTPUT_DIRECTORY
  $script_name run --local NEW_OUTPUT_DIRECTORY
  $script_name cleanup OUTPUT_DIRECTORY

Grades the latest started midterm/midterm-recovery attempt per student, including
both rosters and historical attempt owners. No submission => 0 (instructor policy).
Export, incomplete/ambiguous latest work and grading failures => blank + errors.tsv,
exit 1. Success => grades.csv with USERNAME,GRADE, points out of 100.
Does not collect live work, grant attempts, change clocks or write student records.
Keep grading-extract.py and grading-sandbox.py beside this script.
Requires installed bwrap, systemd, GCC and Python; no packages/images are installed.
On csc-sys use sudo with run --local; elsewhere use SSH/sudo for protected exports.
Each job runs unprivileged with private namespaces and bounded cgroup resources."
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
[[ $run_dir != *$'\n'* && $run_dir != *':'* ]] || die 'Output path cannot contain colons or newlines'
extractor=${0:A:h}/grading-extract.py
sandbox=${0:A:h}/grading-sandbox.py
for executable in python3 systemctl; do
    command -v -- "$executable" >/dev/null || die "Required executable unavailable: $executable; check PATH/install its package"
done
[[ -f $sandbox && ! -L $sandbox ]] || die 'Keep grading-sandbox.py beside this script'
run_id=''
active_job=''
cleanup_one() { python3 "$sandbox" cleanup "$run_id" "$1"; }

if [[ $mode == cleanup ]]; then
    [[ -d $run_dir && ! -L $run_dir && -f $run_dir/run-id ]] || die 'Not a grading run directory'
    run_id=$(< "$run_dir/run-id")
    [[ $run_id =~ '^[a-f0-9]{32}$' ]] || die 'Invalid grading run identity'
    [[ -d $run_dir/control && ! -L $run_dir/control ]] || die 'Not a bwrap grading run; preserve older-run evidence'
    print -r -- 'Cancelled' > "$run_dir/control/cancelled"
    print -r -- 'Cancelled; preserve results and use a new run directory' > "$run_dir/cancelled"
    for job in "$run_dir"/jobs/*(N/); do
        cleanup_one "$job" || die "Cleanup unconfirmed: $job; preserve this directory"
    done
    print -r -- 'Owned grading sandboxes inactive; archives and reports preserved.'
    exit 0
fi

[[ $class_host == --local || $class_host =~ '^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$' ]] || die 'Choose --local or a configured SSH alias/user@host'
ssh_bin=${EXAM_GRADE_SSH_BIN:-ssh}
typeset -a required=(bwrap systemd-run gcc nm awk grep timeout mktemp tar sha256sum head mkdir chmod mv wc)
if [[ $class_host == --local ]]; then
    required+=("${EXAM_GRADE_EXAMCTL_BIN:-/usr/local/sbin/examctl}")
else
    required+=("$ssh_bin")
fi
for executable in "${required[@]}"; do
    command -v -- "$executable" >/dev/null || die "Required executable unavailable: $executable; check PATH/install its package"
done
[[ -f $extractor && ! -L $extractor ]] || die 'Keep grading-extract.py beside this script'
seconds=${EXAM_GRADE_SECONDS:-300}
[[ $seconds == <-> && ${#seconds} -le 4 ]] && (( seconds >= 1 && seconds <= 3600 )) || die 'Grading timeout must be 1..3600 seconds'
materials_source=${EXAM_GRADE_MATERIALS:-/var/lib/exam-agent/templates/sys1-midterm-a/materials}
[[ $materials_source == /* ]] || die 'Authored materials path must be absolute on the class server'
grader_hash=${EXAM_GRADE_GRADER_SHA256:-8b90975bebbe6165cbf7c886c85d029109038201114ce8be3eca9456a98a7d50}
[[ $grader_hash =~ '^[a-f0-9]{64}$' ]] || die 'Expected grader SHA256 must have 64 lowercase hex digits'
[[ $(gcc -dumpmachine) == x86_64-* ]] || die 'The supplied object files require an x86-64 compiler host'

mkdir -m 700 -- "$run_dir"
mkdir -m 700 -- "$run_dir/jobs" "$run_dir/materials"
mkdir -m 755 -- "$run_dir/control"
run_id=$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
print -r -- "$run_id" > "$run_dir/run-id"
trap 'if [[ -n $active_job ]]; then cleanup_one "$active_job" || print -ru2 -- "Cleanup unconfirmed; run cleanup on $run_dir"; fi' EXIT
trap 'print -r -- "Cancelled by INT" > "$run_dir/control/cancelled"; print -r -- "Cancelled" > "$run_dir/cancelled"; exit 130' INT
trap 'print -r -- "Cancelled by TERM" > "$run_dir/control/cancelled"; print -r -- "Cancelled" > "$run_dir/cancelled"; exit 143' TERM

ssh_read() {
    typeset -a quoted=()
    typeset word
    for word in "$@"; do quoted+=("${(qq)word}"); done
    "$ssh_bin" -o BatchMode=yes -o ConnectTimeout=15 "$class_host" "${(j: :)quoted}"
}
ec() {
    if [[ $class_host == --local ]]; then
        "${EXAM_GRADE_EXAMCTL_BIN:-/usr/local/sbin/examctl}" "$@"
    else
        ssh_read sudo -n /usr/local/sbin/examctl "$@"
    fi
}
{ gcc --version; bwrap --version; systemd-run --version; sha256sum "$(command -v gcc)" "$(command -v bwrap)" "$sandbox" "$extractor"; } > "$run_dir/toolchain.txt"

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
if [[ $class_host == --local ]]; then
    tar -C "$materials_source" -czf - -- grade scoring.tsv include tests > "$run_dir/materials.tar.gz"
else
    ssh_read sudo -n tar -C "$materials_source" -czf - -- grade scoring.tsv include tests > "$run_dir/materials.tar.gz"
fi
python3 "$extractor" materials "$run_dir/materials.tar.gz" "$run_dir/materials"
digest=$(sha256sum -- "$run_dir/materials/grade"); digest=${digest%% *}
[[ $digest == "$grader_hash" ]] || die 'Authored grader changed; inspect and explicitly select its SHA256 before grading'
sha256sum -- "$run_dir/materials.tar.gz" > "$run_dir/materials.sha256"
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
    [[ ! -e $run_dir/control/cancelled ]] || die 'Grading cancelled; partial results preserved'
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
    active_job=$job
    attach_ok=true
    if ! python3 "$sandbox" run "$run_id" "$job" "$run_dir/materials" "$extractor" "$run_dir/control" "$seconds" 2>&1 | head -c 1048576 > "$job/grader.log"; then
        attach_ok=false
    fi
    cleanup_one "$job" || die 'Grading cleanup unconfirmed; preserve run and use cleanup'
    active_job=''
    [[ ! -e $run_dir/control/cancelled ]] || die 'Grading cancelled; partial results preserved'
    if [[ $attach_ok != true || ! -f $job/sandbox-exit.txt || $(< "$job/sandbox-exit.txt") != 0 ]]; then
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
[[ ! -e $run_dir/control/cancelled ]] || die 'Grading cancelled; partial results preserved'
mv -n -- "$run_dir/.grades.partial" "$run_dir/grades.csv"
[[ ! -e $run_dir/.grades.partial ]] || die 'CSV destination already exists; no result overwritten'
print -r -- "CSV: $run_dir/grades.csv; errors: $run_dir/errors.tsv"
(( failures == 0 )) || exit 1
