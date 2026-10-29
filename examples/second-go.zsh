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
  $0 prepare DIRECTORY MINUTES BEGIN_FROM BEGIN_UNTIL
  $0 resume-review DIRECTORY
  $0 apply DIRECTORY"
    exit 2
}

select_sources() {
    typeset roster_file=$1 attempts_file=$2 output_file=$3
    typeset student='' record='' started attempt_id checksum
    typeset -i epoch
    typeset -a students=() columns=()
    typeset -A enrolled=() newest=() chosen_id=() chosen_checksum=() tied=()

    while IFS= read -r student || [[ -n $student ]]; do
        [[ -n $student ]] || die 'Blank student in roster'
        (( ! ${+enrolled[$student]} )) || die "Duplicate student: $student"
        students+=("$student")
        enrolled[$student]=1
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
        print -r -- 'username,attempt,checksum'
        for student in "${students[@]}"; do
            printf '%s,%s,%s\n' "$student" "${chosen_id[$student]}" \
                "${chosen_checksum[$student]}"
        done
    } > "$output_file"
}

(( $# >= 2 )) || usage
(( EUID == 0 )) || die 'Run as root on the class server'
mode=$1
run_dir=$2

case $mode in
prepare)
    (( $# == 5 )) || usage
    minutes=$3
    begin_from=$4
    begin_until=$5
    mkdir -m 700 -- "$run_dir"

    ec web exams show "$exam" \
        --receipt "$run_dir/definition.receipt" > /dev/null
    ec web students list "$exam" \
        --all --format tsv --fields username --no-header \
        > "$run_dir/students.txt"
    ec web attempts list \
        "${exam_filters[@]}" \
        --all --format tsv --fields username,start,id,checksum --no-header \
        > "$run_dir/attempts.tsv"

    select_sources "$run_dir/students.txt" "$run_dir/attempts.tsv" \
        "$run_dir/sources.csv"
    students=("${(@f)$(< "$run_dir/students.txt")}")

    ec web grants additional-preview "$exam" "${students[@]}" \
        --definition-from "$run_dir/definition.receipt" \
        --saved-sources "$run_dir/sources.csv" \
        --duration-minutes "$minutes" \
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
