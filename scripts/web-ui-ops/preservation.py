import hashlib,json,os,re,stat
from pathlib import Path

# Authenticated management.go requests and the gateway's admission contract use
# the approved sixty-second operational window. The existing one-second clock
# tolerance is separate; nonce identity/history/pruning proof remain unchanged.
MANAGEMENT_REQUEST_MAX_MS = 60000

def _open_monitoring_root(root, owner):
    """Pin every component without following links, including ancestor links."""
    descriptor=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    identities=[]
    try:
        for component in root.parts[1:]:
            child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=descriptor)
            os.close(descriptor);descriptor=child
            info=os.fstat(descriptor);identities.append((info.st_dev,info.st_ino))
        info=os.fstat(descriptor)
        assert stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode)==0o700 and info.st_uid==owner, 'Unsafe physical purge root'
        return descriptor,identities
    except BaseException:
        os.close(descriptor)
        raise

def _physical_absence(db, root, attempts):
    assert root is not None, 'Changed purge ledger requires independent physical absence proof'
    root=Path(root)
    main=Path(next(row[2] for row in db.execute('PRAGMA database_list') if row[1]=='main'))
    assert root.is_absolute() and '..' not in root.parts and root.name=='monitoring' and root.parent==main.parent, 'Physical purge root must belong to the live database'
    metadata=os.stat(main,follow_symlinks=False)
    assert stat.S_ISREG(metadata.st_mode), 'Live metadata is not a regular file'
    first,identities=_open_monitoring_root(root,metadata.st_uid)
    def absent(descriptor):
        for attempt in attempts:
            try:os.stat(attempt,dir_fd=descriptor,follow_symlinks=False)
            except FileNotFoundError:continue  # Only exact ENOENT proves absence.
            raise AssertionError('Tombstoned monitoring target still exists')
    try:
        absent(first)
        second,current=_open_monitoring_root(root,metadata.st_uid)
        try:
            assert current==identities, 'Physical purge root changed during verification'
            absent(second)
        finally:os.close(second)
    finally:os.close(first)

def _purge_rechecks(db, started, observed, root):
    columns='attempt,status,owner,tries,next,updated,verified,error'
    previous={row[0]:row for row in db.execute('SELECT '+columns+' FROM previous.monitoring_purges')}
    current={row[0]:row for row in db.execute('SELECT '+columns+' FROM main.monitoring_purges')}
    assert previous.keys()==current.keys(), 'Physical purge jobs appeared or disappeared'
    changed=[]
    for attempt,old in previous.items():
        new=current[attempt]
        if old==new:continue
        assert re.fullmatch('[a-zA-Z0-9_-]{1,64}',attempt), 'Unsafe physical purge target'
        assert db.execute('SELECT 1 FROM previous.tombstones WHERE attempt=?',(attempt,)).fetchone() and db.execute('SELECT 1 FROM main.tombstones WHERE attempt=?',(attempt,)).fetchone(), 'Physical purge lacks prior deletion authority'
        for row in (old,new):
            assert row[1]=='verified-absent' and row[2] is None and row[7] is None, 'Physical purge recheck is incomplete or failed'
            assert all(type(row[index]) is int for index in (3,4,5,6)) and 0<=row[3]<=2147483647, 'Invalid physical purge counters/times'
            assert row[5]==row[6] and row[4]==row[6]+3600000, 'Physical purge schedule differs from verified absence'
        assert new[3]==min(old[3]+1,2147483647), 'Physical purge retry count is not one completed recheck'
        assert started<=new[6]<=observed and old[4]<=new[6], 'Physical purge recheck predates deployment or was not due'
        changed.append(attempt)
    if changed:_physical_absence(db,root,changed)
    return len(changed)

def verify(db, started, observed, agent, monitoring_root=None):
    """Preserve authority; prove idle polls, expiry and completed absence rechecks."""
    schema = "SELECT type,name,tbl_name,sql FROM {}.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
    assert db.execute(schema.format('main')).fetchall() == db.execute(schema.format('previous')).fetchall(), 'Database schema changed during UI-only update'
    volatile = {'agent_snapshot', 'agent_events', 'agent_attempt_sequence'}
    special = {'audit', 'agent_management_nonces', 'agent_management_requests'}
    preserved = []
    for (table,) in db.execute("SELECT name FROM previous.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        assert table.replace('_', '').isalnum()
        if table in volatile | special:
            continue
        if table=='monitoring_purges':
            preserved.append(table)
            continue  # Checked by its strict tombstone/transition/physical proof below.
        q = '"' + table + '"'
        assert not db.execute('SELECT * FROM previous.' + q + ' EXCEPT SELECT * FROM main.' + q + ' LIMIT 1').fetchall(), 'Existing authority changed: ' + table
        assert not db.execute('SELECT * FROM main.' + q + ' EXCEPT SELECT * FROM previous.' + q + ' LIMIT 1').fetchall(), 'New authority appeared: ' + table
        preserved.append(table)
    physical_purge_rechecks=_purge_rechecks(db,started,observed,monitoring_root) if 'monitoring_purges' in preserved else 0
    for table in ('attempts', 'attempt_grants'):
        if table not in preserved:
            continue
        assert db.execute('SELECT rowid,* FROM main.'+table+' ORDER BY rowid').fetchall() == db.execute('SELECT rowid,* FROM previous.'+table+' ORDER BY rowid').fetchall(), 'Historical order changed: '+table
    for table in ('audit', 'agent_management_requests'):
        assert not db.execute('SELECT * FROM previous.' + table + ' EXCEPT SELECT * FROM main.' + table + ' LIMIT 1').fetchall(), 'Prior history changed: ' + table
    removed = db.execute('SELECT * FROM previous.agent_management_nonces EXCEPT SELECT * FROM main.agent_management_nonces').fetchall()
    added = db.execute('SELECT * FROM main.agent_management_nonces EXCEPT SELECT * FROM previous.agent_management_nonces').fetchall()
    assert all(row[0] == agent and started <= row[2] <= observed + MANAGEMENT_REQUEST_MAX_MS + 1000 for row in added), 'Unexpected nonce identity/lifetime'
    requests = db.execute('SELECT * FROM main.agent_management_requests EXCEPT SELECT * FROM previous.agent_management_requests').fetchall()
    request_ids = set()
    poll_created = {}
    poll_fingerprint = hashlib.sha256(b'{"operation":"grants.source-next","body":{}}').hexdigest()
    for identity, request, fingerprint, created, outcome in requests:
        assert identity == agent and started <= created <= observed + 1000, 'Unexpected management request'
        assert fingerprint == poll_fingerprint, 'Idle poll fingerprint differs from the actual empty source-next operation'
        assert json.loads(outcome) == {'ok': True, 'status': 200, 'result': {'task': None}}, 'Management changed more than idle polling'
        request_ids.add(request)
        poll_created[request] = created
    audit = db.execute('SELECT * FROM main.audit EXCEPT SELECT * FROM previous.audit').fetchall()
    audit_ids = set()
    for ident, at, actor, action, target, detail in audit:
        assert actor == 'agent:' + agent + ':root' and action == 'management-grants.source-next', 'Unexpected new audit operation'
        assert started <= at <= observed + 1000
        assert json.loads(detail) == {'confirmed': True, 'operation': 'grants.source-next', 'target': 'exams'}
        assert target in request_ids, 'Idle audit lacks its durable request'
        assert target not in audit_ids and poll_created[target] <= at, 'Idle poll lacks one causally ordered confirmation'
        audit_ids.add(target)
    assert audit_ids == request_ids, 'Idle requests lack complete audit history'
    # The handler prunes expires < observed, then stores that exact observed
    # value in request.created. Its later audit timestamp is not the cutoff.
    # Every permitted deletion therefore needs a new, fully audited empty poll
    # whose captured cutoff is strictly later than the nonce expiry. Merely
    # being expired by this verification's wall clock is insufficient evidence.
    cutoff = max((at for at in poll_created.values() if at <= observed), default=None)
    assert all(cutoff is not None and row[2] < cutoff and row[2] < observed for row in removed), 'Nonce removal lacks a fully audited empty poll after its expiry, or nonce is currently live'
    return {'preserved_tables': preserved, 'physical_purge_rechecks':physical_purge_rechecks, 'prior_audit_preserved': True, 'prior_management_requests_preserved': True,
            'expired_before_start_nonces_pruned': sum(row[2] < started for row in removed),
            'expired_after_proof_start_nonces_pruned': sum(row[2] >= started for row in removed),
            'nonce_prune_audited_cutoff_ms': cutoff, 'current_fresh_nonces': len(added), 'audited_empty_queue_polls': len(requests)}
