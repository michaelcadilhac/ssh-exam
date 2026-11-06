#!/usr/bin/env python3
"""Read a fresh independently bridged guard for one matched native transition."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import stat
import sys


def private_json(path):
    before=path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_uid!=os.geteuid() or before.st_mode&0o077 or before.st_nlink!=1 or before.st_size>131072:
        raise ValueError('Unsafe private cohort receipt')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as source:
        current=os.fstat(source.fileno());raw=source.read(131073)
    if (before.st_dev,before.st_ino,before.st_size)!=(current.st_dev,current.st_ino,len(raw)):
        raise ValueError('Cohort receipt changed while reading')
    return json.loads(raw),raw


def validate(release,value,phase,transition=None,observed=None):
    if phase not in ('before','after'): raise ValueError('Use before or after')
    update=release['native_update'];after=phase=='after';cohort=update[phase]
    at=datetime.datetime.fromisoformat(value['at']);now=observed or datetime.datetime.now(datetime.timezone.utc)
    if at.tzinfo is None or not -1<=(now-at).total_seconds()<=90: raise ValueError('Native guard expired; refresh from the class server')
    if (value.get('guard')!='PASS' or value.get('host')!='csc-sys' or value.get('production_writes') is not False
            or value.get('nonce')!=update['nonce'] or value.get('phase')!=phase+'-native'
            or value.get('binary_sha256')!=cohort['binary_sha256']):
        raise ValueError('Native guard belongs to another transition/cohort')
    for field,target in [('history_sha256','native_history_sha256'),('config_sha256','native_config_sha256'),('cli_config_sha256','cli_config_sha256')]:
        if value.get(field)!=release[target]: raise ValueError('Native authority/configuration/relay changed: '+field)
    relay_update=release.get('fast_ui',{}).get('reviewed_scope')=='monitoring-timeouts-v2'
    expected_relay=cohort['binary_sha256'].get('exam-ssh-relay',release['relay_sha256'])
    if value.get('relay_sha256')!=expected_relay: raise ValueError('Loaded relay differs from this cohort')
    if value.get('installed_cli_sha256')!=cohort['binary_sha256']['examctl'] or value.get('worker_cli_sha256')!=cohort['worker_cli_sha256']:
        raise ValueError('Installed and loaded cohort differ from this phase')
    pids=update['before']['service_pids']
    if after:
        if transition is None: raise ValueError('Native transition receipt is missing')
        receipt=json.loads(transition)
        if (receipt.get('phase')!='NATIVE_MATCHED_VERIFIED' or receipt.get('nonce')!=update['nonce']
                or receipt.get('binary_sha256')!=cohort['binary_sha256']
                or any(receipt.get(field)!=release[target] for field,target in [('history_sha256','native_history_sha256'),('config_sha256','native_config_sha256'),('cli_config_sha256','cli_config_sha256')])
                or value.get('transition_receipt_sha256')!=hashlib.sha256(transition).hexdigest() or value.get('policy_supported') is not True):
            raise ValueError('After guard lacks this exact verified transition/live policy')
        pids=receipt['service_pids']
    rows=value['native_roles'];current={row['unit']:row['pid'] for row in rows};current['exam-ssh-relay.service']=value['relay_pid']
    if (len(rows)!=3 or current!=pids or set(pids)!=set(update['before']['service_pids'])
            or (not relay_update and pids['exam-ssh-relay.service']!=update['before']['service_pids']['exam-ssh-relay.service'])
            or any(type(pid) is not int or pid<=0 for pid in pids.values())):
        raise ValueError('Native processes or untouched relay changed')
    return value


def read_current(stage,phase,observed=None):
    if phase not in ('before','after'): raise ValueError('Use before or after')
    info=stage.lstat()
    if not stat.S_ISDIR(info.st_mode) or stage.is_symlink() or info.st_uid!=os.geteuid() or info.st_mode&0o077:
        raise ValueError('Unsafe private guard stage')
    release,_=private_json(stage/'release.json');wrapped,_=private_json(stage/('native-guard-'+phase+'.json'))
    if wrapped.get('nonce')!=release['native_update']['nonce']: raise ValueError('Guard bridge nonce differs')
    transition=None
    if phase=='after':
        path=Path(release['native_update']['transition_receipt'])
        if path.parent!=stage: raise ValueError('Transition must stay in this private release stage')
        _,transition=private_json(path)
    return validate(release,wrapped['receipt'],phase,transition,observed)


if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit('fresh_native_cohort_guard.py PRIVATE_RELEASE_STAGE before|after')
    print(json.dumps(read_current(Path(sys.argv[1]),sys.argv[2])),flush=True)
