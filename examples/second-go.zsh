#!/usr/bin/env zsh
# Reviewed saved-work batch example. Requires matching examctl scripting support.
# prepare creates no usable permission; apply confirms the review and verifies pins.
emulate -R zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077
script_name=$0

typeset -a examctl=("${EXAMCTL_BIN:-/usr/local/sbin/examctl}")
if [[ -n ${EXAMCTL_CONFIG:-} ]]; then
    examctl+=(--config "$EXAMCTL_CONFIG")
fi
ec() { "${examctl[@]}" "$@"; }
exam=${EXAMCTL_EXAM:-midterm}
typeset -a source_exams=("${(@s: :)${EXAMCTL_SOURCE_EXAMS:-midterm midterm-recovery}}")
typeset -a exam_filters=()
for source_exam in "${source_exams[@]}"; do
    exam_filters+=(--exam "$source_exam")
done

die() { print -ru2 -- "$*"; exit 1; }
usage() {
    print -ru2 -- "Usage:
  $script_name prepare DIRECTORY BEGIN_FROM BEGIN_UNTIL
  $script_name resume-review DIRECTORY
  $script_name apply DIRECTORY

Preserves effective midterm time/webcam for everyone. Students with no started
source attempt get the exact pinned starter template; others require their latest
protected saved work. Review both groups before apply. Saved-work availability
requires native source verification. Retry partial outcomes in the SAME directory.
Prepare needs a NEW directory; existing failed preparations/reviews are preserved."
    exit ${1:-2}
}

select_sources() {
    typeset roster_file=$1 defaults_file=$2 attempts_file=$3 output_file=$4 starters_file=$5 groups_file=$6
    typeset student='' record='' started attempt_id checksum duration camera
    typeset default_duration default_camera starter_name starter_hash
    typeset -i epoch duration_seconds saved_count=0 starter_count=0
    typeset -a students=() columns=() default_lines=()
    typeset -A enrolled=() newest=() chosen_id=() chosen_checksum=() tied=()
    typeset -A allowances=() webcams=()

    default_lines=("${(@f)$(< "$defaults_file")}")
    (( ${#default_lines} == 1 )) || die 'Expected one row of midterm defaults'
    record=$default_lines[1]
    columns=("${(@ps:\t:)record}")
    (( ${#columns} == 4 )) || die 'Expected duration, webcam, starter name and exact version'
    default_duration=$columns[1]
    default_camera=$columns[2]
    starter_name=$columns[3]
    starter_hash=$columns[4]
    [[ $starter_name =~ '^[a-zA-Z0-9_-]{1,64}$' && $starter_hash =~ '^[a-f0-9]{64}$' ]] ||
        die 'Midterm needs an exact verified/attested starter version; inspect templates verify/sync and web exams update --template-version. No automatic latest selection.'
    [[ $default_duration == <-> && ${#default_duration} -le 5 ]] &&
        (( 10#$default_duration >= 60 && 10#$default_duration <= 21600 )) ||
        die 'Invalid midterm default allowance'
    [[ $default_camera == true || $default_camera == false ]] ||
        die 'Invalid midterm default webcam requirement'

    while IFS= read -r record || [[ -n $record ]]; do
        columns=("${(@ps:\t:)record}")
        (( ${#columns} == 3 )) || die 'Malformed midterm roster/settings export'
        student=$columns[1]
        [[ $student =~ '^[a-zA-Z][a-zA-Z0-9_-]{0,31}$' ]] || die 'Invalid student in roster'
        (( ! ${+enrolled[$student]} )) || die "Duplicate student: $student"
        # Null overrides are empty TSV fields: resolve them against this same
        # saved midterm definition, never the chosen source attempt's settings.
        duration=${columns[2]:-$default_duration}
        [[ $duration == <-> && ${#duration} -le 5 ]] ||
            die "$student: invalid midterm allowance"
        duration_seconds=$(( 10#$duration ))
        (( duration_seconds >= 60 && duration_seconds <= 21600 )) ||
            die "$student: midterm allowance must be 60..21600 seconds"
        camera=${columns[3]:-$default_camera}
        case $camera in
            0|false) camera=false ;;
            1|true) camera=true ;;
            *) die "$student: invalid midterm webcam requirement" ;;
        esac
        students+=("$student")
        enrolled[$student]=1
        allowances[$student]=$duration_seconds
        webcams[$student]=$camera
    done < "$roster_file"
    (( ${#students} > 0 )) || die 'The roster is empty'

    while IFS= read -r record || [[ -n $record ]]; do
        # Preserve empty columns, including an empty trailing checksum.
        columns=("${(@ps:\t:)record}")
        (( ${#columns} == 4 )) || die 'Malformed attempt export'
        student=$columns[1]
        (( ${+enrolled[$student]} )) || continue
        started=$columns[2]
        [[ -n $started ]] || continue
        [[ $started == <-> && ${#started} -le 16 ]] ||
            die "Invalid start time for $student"
        epoch=$(( 10#$started ))
        (( epoch > 0 )) || continue
        attempt_id=$columns[3]
        checksum=$columns[4]

        if (( ! ${+newest[$student]} || epoch > ${newest[$student]:-0} )); then
            newest[$student]=$epoch
            chosen_id[$student]=$attempt_id
            chosen_checksum[$student]=$checksum
            tied[$student]=0
        elif (( epoch == ${newest[$student]} )) &&
             [[ $attempt_id != "${chosen_id[$student]}" ||
                $checksum != "${chosen_checksum[$student]}" ]]; then
            tied[$student]=1
        fi
    done < "$attempts_file"

    for student in "${students[@]}"; do
        if (( ! ${+newest[$student]} )); then
            (( ++starter_count ))
            continue
        fi
        (( ${tied[$student]} == 0 )) || die "$student: ambiguous latest attempt"
        [[ ${chosen_id[$student]} =~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' &&
           ${chosen_checksum[$student]} =~ '^[a-f0-9]{64}$' ]] ||
            die "$student: latest started attempt has no valid protected source; no starter/older-work fallback"
        (( ++saved_count ))
    done

    {
        print -r -- 'username,attempt,checksum,duration_seconds,require_webcam'
        for student in "${students[@]}"; do
            (( ${+newest[$student]} )) || continue
            printf '%s,%s,%s,%s,%s\n' "$student" "${chosen_id[$student]}" \
                "${chosen_checksum[$student]}" "${allowances[$student]}" \
                "${webcams[$student]}"
        done
    } > "$output_file"
    {
        for student in "${students[@]}"; do
            (( ${+newest[$student]} )) && continue
            printf '{"username":"%s","settings":{"duration":%s,"webcam":%s},"work":{"kind":"template","name":"%s","hash":"%s"}}\n' \
                "$student" "${allowances[$student]}" "${webcams[$student]}" "$starter_name" "$starter_hash"
        done
    } > "$starters_file"
    {
        if (( saved_count > 0 )); then print -r -- saved; fi
        if (( starter_count > 0 )); then print -r -- starter; fi
    } > "$groups_file"
    print -r -- "Selected $saved_count saved-work and $starter_count starter-file students."
}

receipt_path() {
    typeset prefix=''
    [[ $1 != starter ]] || prefix=starter-
    print -r -- "$run_dir/${prefix}$2.receipt"
}

verify_plan() {
    [[ $(< "$run_dir/plan.version") == 2 ]] || die 'Unsupported/incomplete plan; preserve its directory'
    (cd -- "$run_dir" && sha256sum --check --status plan.sha256) ||
        die 'Prepared inputs changed/incomplete; preserve original files and receipts, never silently refresh a reviewed intent'
    review_groups=("${(@f)$(< "$run_dir/groups.tsv")}")
    (( ${#review_groups} >= 1 && ${#review_groups} <= 2 )) || die 'Invalid review groups'
    typeset -A seen_groups=()
    typeset kind
    for kind in "${review_groups[@]}"; do
        [[ $kind == saved || $kind == starter ]] || die 'Invalid review group'
        (( ! ${+seen_groups[$kind]} )) || die 'Duplicate review group'
        seen_groups[$kind]=1
    done
}

review_all() {
    verify_plan
    typeset -a window=("${(@ps:\t:)$(< "$run_dir/window.tsv")}")
    (( ${#window} == 2 )) || die 'Invalid saved Begin window'
    typeset kind receipt input
    for kind in "${review_groups[@]}"; do
        receipt=$(receipt_path "$kind" review)
        print -r -- "Reviewing $kind group: $receipt"
        if [[ -e $receipt ]]; then
            ec web grants additional-preview --from-receipt "$receipt" --resume --format table
        else
            input=$run_dir/sources.csv
            [[ $kind != starter ]] || input=$run_dir/starters.jsonl
            ec web grants additional-preview "$exam" \
                --definition-from "$run_dir/definition.receipt" --input "$input" \
                --earliest "$window[1]" --latest "$window[2]" \
                --reason 'Second midterm attempt from reviewed saved work or approved starter files' \
                --receipt "$receipt" --format table
        fi
    done
}

apply_all() {
    verify_plan
    typeset kind review issued synchronization
    # No group is confirmed until every selected group has a review receipt.
    for kind in "${review_groups[@]}"; do
        [[ -f $(receipt_path "$kind" review) ]] ||
            die 'Preparation incomplete: run resume-review on this directory before apply'
    done
    for kind in "${review_groups[@]}"; do
        review=$(receipt_path "$kind" review)
        issued=$(receipt_path "$kind" issued)
        print -r -- "Applying $kind group; retain this directory for partial-outcome retries."
        ec web grants issue-confirm --from-receipt "$review" --receipt "$issued" --resume --format table
        if [[ $kind == saved ]]; then
            synchronization=$(receipt_path "$kind" synchronization)
            ec web grants source-sync --from-receipt "$issued" --receipt "$synchronization" --resume --format table
        fi
    done
}

(( $# != 1 )) || { [[ $1 != --help && $1 != -h ]] || usage 0; }
(( $# >= 2 )) || usage
(( EUID == 0 )) || die 'Run as root on the class server'
mode=$1
run_dir=$2
typeset -a review_groups=()

case $mode in
prepare)
    (( $# == 4 )) || usage
    begin_from=$3
    begin_until=$4
    mkdir -m 700 -- "$run_dir" || die 'Use a NEW directory; preserve existing preparations and receipts'

    if ! ec web exams show "$exam" \
        --receipt "$run_dir/definition.receipt" \
        --format tsv --fields exam.duration,exam.webcam,exam.template,exam.template_version --no-header \
        > "$run_dir/defaults.tsv"; then
        die 'Cannot read an exact versioned definition. Inspect the error above; verify/sync the starter and select its exact --template-version before a NEW preparation.'
    fi
    ec web students list "$exam" \
        --all --format tsv --fields username,duration,webcam --no-header \
        > "$run_dir/students.tsv"
    ec web attempts list \
        "${exam_filters[@]}" \
        --all --format tsv --fields username,start,id,checksum --no-header \
        > "$run_dir/attempts.tsv"

    select_sources "$run_dir/students.tsv" "$run_dir/defaults.tsv" \
        "$run_dir/attempts.tsv" "$run_dir/sources.csv" "$run_dir/starters.jsonl" "$run_dir/groups.tsv"
    printf '%s\t%s\n' "$begin_from" "$begin_until" > "$run_dir/window.tsv"
    (cd -- "$run_dir" && sha256sum -- definition.receipt defaults.tsv students.tsv attempts.tsv sources.csv starters.jsonl groups.tsv window.tsv > plan.sha256)
    print -r -- 2 > "$run_dir/plan.version"
    review_all
    ;;
resume-review)
    (( $# == 2 )) || usage
    if [[ -e $run_dir/plan.version || -e $run_dir/plan.sha256 || -e $run_dir/starters.jsonl ]]; then
        review_all
    else
        [[ -f $run_dir/review.receipt ]] || die 'No completed review here; preserve this failed preparation and use a NEW directory'
        ec web grants additional-preview --from-receipt "$run_dir/review.receipt" --resume --format table
    fi
    ;;
apply)
    (( $# == 2 )) || usage
    if [[ -e $run_dir/plan.version || -e $run_dir/plan.sha256 || -e $run_dir/starters.jsonl ]]; then
        apply_all
    else
        [[ -f $run_dir/review.receipt ]] || die 'No completed review here; preserve this failed preparation and use a NEW directory'
        ec web grants issue-confirm --from-receipt "$run_dir/review.receipt" \
            --receipt "$run_dir/issued.receipt" --resume --format table
        ec web grants source-sync --from-receipt "$run_dir/issued.receipt" \
            --receipt "$run_dir/synchronization.receipt" --resume --format table
    fi
    ;;
*) usage ;;
esac
