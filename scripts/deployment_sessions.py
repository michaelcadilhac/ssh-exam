"""Read session activity inside the caller's existing query-only transaction."""


def activity(database, now_ms, allow_admin=False, allow_idle_students=False):
    if type(allow_admin) is not bool or type(allow_idle_students) is not bool:
        raise ValueError('Session-drain options must be booleans')
    counts = dict(database.execute(
        'SELECT role,count(*) FROM sessions WHERE expires>? GROUP BY role',
        (now_ms,),
    ))
    admins = counts.get('admin', 0)
    allowed_students = counts.get('student', 0) if allow_idle_students else 0
    return {
        # This classifies login tokens only. The caller must independently
        # prove no unfinished attempts, holds, pending operations or live
        # SSH/preflight processes/connections before stopping anything.
        'blocking': sum(counts.values()) - (admins if allow_admin else 0) - allowed_students,
        'admins': admins,
        'allowed_student_tokens': allowed_students,
        'independent_live_work_checks_required': allow_idle_students,
        'by_role': counts,
    }
