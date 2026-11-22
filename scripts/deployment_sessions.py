"""Read session activity inside the caller's existing query-only transaction."""


def activity(database, now_ms, allow_admin=False):
    if type(allow_admin) is not bool:
        raise ValueError('allow_admin_sessions must be a boolean')
    counts = dict(database.execute(
        'SELECT role,count(*) FROM sessions WHERE expires>? GROUP BY role',
        (now_ms,),
    ))
    admins = counts.get('admin', 0)
    return {
        'blocking': sum(counts.values()) - (admins if allow_admin else 0),
        'admins': admins,
        'by_role': counts,
    }
