import hashlib,json

def verify(db, started, observed, agent):
    """Preserve authority/history exactly; prove only expired nonces and idle polls vary."""
    schema = "SELECT type,name,tbl_name,sql FROM {}.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
    assert db.execute(schema.format('main')).fetchall() == db.execute(schema.format('previous')).fetchall(), 'Database schema changed during UI-only update'
    volatile = {'agent_snapshot', 'agent_events', 'agent_attempt_sequence'}
    special = {'audit', 'agent_management_nonces', 'agent_management_requests'}
    preserved = []
    for (table,) in db.execute("SELECT name FROM previous.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        assert table.replace('_', '').isalnum()
        if table in volatile | special:
            continue
        q = '"' + table + '"'
        assert not db.execute('SELECT * FROM previous.' + q + ' EXCEPT SELECT * FROM main.' + q + ' LIMIT 1').fetchall(), 'Existing authority changed: ' + table
        assert not db.execute('SELECT * FROM main.' + q + ' EXCEPT SELECT * FROM previous.' + q + ' LIMIT 1').fetchall(), 'New authority appeared: ' + table
        preserved.append(table)
    for table in ('attempts', 'attempt_grants'):
        if table not in preserved:
            continue
        assert db.execute('SELECT rowid,* FROM main.'+table+' ORDER BY rowid').fetchall() == db.execute('SELECT rowid,* FROM previous.'+table+' ORDER BY rowid').fetchall(), 'Historical order changed: '+table
    for table in ('audit', 'agent_management_requests'):
        assert not db.execute('SELECT * FROM previous.' + table + ' EXCEPT SELECT * FROM main.' + table + ' LIMIT 1').fetchall(), 'Prior history changed: ' + table
    removed = db.execute('SELECT * FROM previous.agent_management_nonces EXCEPT SELECT * FROM main.agent_management_nonces').fetchall()
    added = db.execute('SELECT * FROM main.agent_management_nonces EXCEPT SELECT * FROM previous.agent_management_nonces').fetchall()
    assert all(row[0] == agent and started <= row[2] <= observed + 31000 for row in added), 'Unexpected nonce identity/lifetime'
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
    return {'preserved_tables': preserved, 'prior_audit_preserved': True, 'prior_management_requests_preserved': True,
            'expired_before_start_nonces_pruned': sum(row[2] < started for row in removed),
            'expired_after_proof_start_nonces_pruned': sum(row[2] >= started for row in removed),
            'nonce_prune_audited_cutoff_ms': cutoff, 'current_fresh_nonces': len(added), 'audited_empty_queue_polls': len(requests)}
