#!/usr/bin/env zsh
# Reviewed saved-work batch example. Requires matching examctl scripting support.
# prepare creates no usable permission; apply confirms the review and verifies pins.
emulate -R zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077

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
  $0 prepare DIRECTORY BEGIN_FROM BEGIN_UNTIL
  $0 resume-review DIRECTORY
  $0 apply DIRECTORY"
    exit 2
}

select_sources() {
    typeset roster_file=$1 defaults_file=$2 attempts_file=$3 output_file=$4
    typeset student='' record='' started attempt_id checksum duration camera
    typeset default_duration default_camera
    typeset -i epoch duration_seconds
    typeset -a students=() columns=() default_lines=()
    typeset -A enrolled=() newest=() chosen_id=() chosen_checksum=() tied=()
    typeset -A allowances=() webcams=()

    default_lines=("${(@f)$(< "$defaults_file")}")
    (( ${#default_lines} == 1 )) || die 'Expected one row of midterm defaults'
    record=$default_lines[1]
    columns=("${(@ps:\t:)record}")
    (( ${#columns} == 2 )) || die 'Malformed midterm defaults'
    default_duration=$columns[1]
    default_camera=$columns[2]
    [[ $default_duration == <-> && ${#default_duration} -le 5 ]] &&
        (( 10#$default_duration >= 60 && 10#$default_duration <= 21600 )) ||
        die 'Invalid midterm default allowance'
    [[ $default_camera == true || $default_camera == false ]] ||
        die 'Invalid midterm default webcam requirement'

    while IFS= read -r record || [[ -n $record ]]; do
        columns=("${(@ps:\t:)record}")
        (( ${#columns} == 3 )) || die 'Malformed midterm roster/settings export'
        student=$columns[1]
        [[ -n $student ]] || die 'Blank student in roster'
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
        (( ${+newest[$student]} )) || die "$student: no started attempt"
        (( ${tied[$student]} == 0 )) || die "$student: ambiguous latest attempt"
    done

    {
        print -r -- 'username,attempt,checksum,duration_seconds,require_webcam'
        for student in "${students[@]}"; do
            printf '%s,%s,%s,%s,%s\n' "$student" "${chosen_id[$student]}" \
                "${chosen_checksum[$student]}" "${allowances[$student]}" \
                "${webcams[$student]}"
        done
    } > "$output_file"
}

(( $# >= 2 )) || usage
(( EUID == 0 )) || die 'Run as root on the class server'
mode=$1
run_dir=$2

case $mode in
prepare)
    (( $# == 4 )) || usage
    begin_from=$3
    begin_until=$4
    mkdir -m 700 -- "$run_dir"

    ec web exams show "$exam" \
        --receipt "$run_dir/definition.receipt" \
        --format tsv --fields exam.duration,exam.webcam --no-header \
        > "$run_dir/defaults.tsv"
    ec web students list "$exam" \
        --all --format tsv --fields username,duration,webcam --no-header \
        > "$run_dir/students.tsv"
    ec web attempts list \
        "${exam_filters[@]}" \
        --all --format tsv --fields username,start,id,checksum --no-header \
        > "$run_dir/attempts.tsv"

    select_sources "$run_dir/students.tsv" "$run_dir/defaults.tsv" \
        "$run_dir/attempts.tsv" "$run_dir/sources.csv"

    ec web grants additional-preview "$exam" \
        --definition-from "$run_dir/definition.receipt" \
        --input "$run_dir/sources.csv" \
        --earliest "$begin_from" --latest "$begin_until" \
        --reason 'Second midterm attempt from reviewed saved work' \
        --receipt "$run_dir/review.receipt" --format table
    ;;
resume-review)
    (( $# == 2 )) || usage
    ec web grants additional-preview \
        --from-receipt "$run_dir/review.receipt" --resume --format table
    ;;
apply)
    (( $# == 2 )) || usage
    ec web grants issue-confirm \
        --from-receipt "$run_dir/review.receipt" \
        --receipt "$run_dir/issued.receipt" --resume --format table
    ec web grants source-sync \
        --from-receipt "$run_dir/issued.receipt" \
        --receipt "$run_dir/synchronization.receipt" --resume --format table
    ;;
*) usage ;;
esac
