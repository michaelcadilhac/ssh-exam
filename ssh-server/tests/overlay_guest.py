#!/usr/bin/env python3
"""Candidate checks INSIDE the disposable overlay, never on the class host."""
from contextlib import contextmanager
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import select
import shutil
import socket
import stat
import struct
import subprocess
import tempfile
import time
import traceback
import uuid
import sys

INPUT = Path('/run/ssh-exam-qualification-input')
OUTPUT = Path('/run/ssh-exam-qualification-output')
REQUIRED = ('python3', 'systemctl', 'ssh', 'ssh-keygen', 'sftp', 'crontab',
            'su', 'bwrap', 'setpriv', 'systemd-run', 'sshd', 'usermod',
            'gpasswd', 'loginctl', 'sudo', 'nohup', 'sleep', 'ln', 'mkfifo', 'useradd')
NATIVE_PATHS = {
    'exam-agent': Path('/usr/local/sbin/exam-agent'),
    'examctl': Path('/usr/local/sbin/examctl'),
    'exam-login': Path('/usr/local/libexec/exam-login'),
    'exam-info': Path('/usr/local/bin/exam-info'),
}
NATIVE_SERVICES = ('exam-agent.service', 'exam-deadline-watchdog.service', 'exam-source-setup.service')


def require_execution_policy_profile(marker, username, install_proof=None):
    """Exact shared marker contract for the two real policy-probe callers."""
    assert username == marker.get('username') == 'examq'
    assert marker.get('profile') in ('execution-policy', 'native-install')
    if marker['profile'] == 'native-install':
        nonce = marker['native_nonce']
        assert str(uuid.UUID(nonce)) == nonce
        expected = marker['native_sha256']
        assert isinstance(expected, dict) and set(expected) == set(NATIVE_PATHS)
        assert all(re.fullmatch('[a-f0-9]{64}', value) for value in expected.values())
        assert isinstance(install_proof, dict) and isinstance(install_proof.get('results'), dict)
        verified = install_proof['results'].get('verify', {})
        after = install_proof['results'].get('guard-after', {})
        assert verified.get('phase') == 'NATIVE_MATCHED_VERIFIED' and verified.get('nonce') == nonce
        assert verified.get('binary_sha256') == expected
        assert after.get('phase') == 'after-native' and after.get('nonce') == nonce
        assert after.get('binary_sha256') == expected and after.get('policy_supported') is True
        assert after.get('host') == 'private-native-install-qualification' and after.get('fixture') is True
        assert after.get('production_writes') is False


def native_install_context():
    assert os.getuid() == os.geteuid() == 0
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount()
    marker = json.loads((INPUT / 'run.json').read_text())
    assert marker['profile'] == 'native-install' and marker['username'] == 'examq'
    assert str(uuid.UUID(marker['native_nonce'])) == marker['native_nonce']
    assert set(marker['native_sha256']) == set(NATIVE_PATHS)
    assert all(re.fullmatch('[a-f0-9]{64}', value) for value in marker['native_sha256'].values())
    config = json.loads(Path('/etc/exam-agent/agent.json').read_text())
    guards = json.loads(Path(config['guard_report']).read_text())
    assert guards.get('fixture', '').startswith('Private qualification')
    assert config['callback_url'] == 'https://127.0.0.1:9444'
    assert not config.get('functional_test_account') and config.get('temporary_account_policy')
    return marker, config


def bootstrap_native_install():
    """Copy candidate bytes only into this volatile overlay before roles load."""
    marker, config = native_install_context()
    state = json.loads((Path(config['state']) / 'state.json').read_text())
    verify_finished_guest(state, 'native-install')
    for service in NATIVE_SERVICES:
        result = subprocess.run(['systemctl', 'show', service, '--property=MainPID', '--value'],
                                check=True, capture_output=True, text=True, timeout=10)
        assert int(result.stdout.strip() or '0') == 0, 'Bootstrap refuses an already loaded native role'
    installed = {}
    for name, target in NATIVE_PATHS.items():
        assert target.parent.is_dir() and target.parent.resolve() == target.parent
        if target.exists():
            current = target.lstat()
            assert stat.S_ISREG(current.st_mode) and current.st_uid == 0 and current.st_nlink == 1
        assert not target.is_symlink()
        descriptor = os.open(INPUT / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as source:
            info = os.fstat(source.fileno())
            assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_size <= 64 * 1024**2
            data = source.read(64 * 1024**2 + 1)
        assert hashlib.sha256(data).hexdigest() == marker['native_sha256'][name]
        assert data.startswith(b'\x7fELF'), 'A Linux ELF candidate is required'
        # ELF loaders ignore bytes after the executable. This is the same code
        # with a distinct private fixture identity, not an older protocol build.
        # Distinct hashes force the REAL adapter to atomically replace all four
        # files; equal before/after bytes would only exercise its no-op branch.
        data += b'\nPRIVATE_NATIVE_BEFORE_COHORT:' + marker['native_nonce'].encode() + b'\n'
        descriptor, temporary = tempfile.mkstemp(prefix='.private-native-bootstrap-', dir=target.parent)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(data)
                os.fchmod(stream.fileno(), 0o755)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
            directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            Path(temporary).unlink(missing_ok=True)
        assert not target.is_mount(), 'Candidate installation target must be replaceable overlay data'
        actual = target.stat()
        installed[name] = {'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'device': actual.st_dev, 'inode': actual.st_ino}
    receipt = OUTPUT / 'native-bootstrap.json'
    descriptor = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump({'nonce': marker['native_nonce'], 'candidate_sha256': marker['native_sha256'], 'installed': installed,
                   'before_identity': 'same ELF code, nonce footer makes all four before bytes distinct'}, stream)
        stream.flush(); os.fsync(stream.fileno())
    print('PRIVATE_NATIVE_BOOTSTRAP_OK', flush=True)
    return 0


NATIVE_FIXTURE_GUARD = r'''#!/usr/bin/python3
import datetime, hashlib, json, os, stat, subprocess, sys
from pathlib import Path
INPUT=Path('/run/ssh-exam-qualification-input')
OUTPUT=Path('/run/ssh-exam-qualification-output')
assert os.getuid()==os.geteuid()==0 and __debug__
assert Path('/run/systemd/container').read_text().strip()=='systemd-nspawn'
assert INPUT.is_mount() and OUTPUT.is_mount()
stage=Path(sys.argv[1]).resolve()
assert stage.is_relative_to(OUTPUT) and stage.name in ('guard-before','guard-after') and sys.argv[2:] == ['after-cli']
marker=json.loads((INPUT/'run.json').read_text())
assert marker['profile']=='native-install' and marker['username']=='examq'
release=json.loads((stage/'release.json').read_text())
assert release['native_update']['nonce']==marker['native_nonce']
def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
config_path=Path('/etc/exam-agent/agent.json')
config=json.loads(config_path.read_text())
assert json.loads(Path(config['guard_report']).read_text()).get('fixture','').startswith('Private qualification')
assert config['callback_url']=='https://127.0.0.1:9444' and config.get('temporary_account_policy') and not config.get('functional_test_account')
state=json.loads((Path(config['state'])/'state.json').read_text())
history=hashlib.sha256(json.dumps(state['attempts'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
assert history==release['native_history_sha256']
assert all(a['state'] in ('COMPLETED','CANCELLED_BEFORE_START') and a.get('access_state')!='HELD' and a.get('policy_state','NORMAL')=='NORMAL' for a in state['attempts'].values())
assert digest(config_path)==release['native_config_sha256']
assert digest('/etc/exam-agent/examctl.json')==release['cli_config_sha256']
side='after' if stage.name=='guard-after' else 'before'
expected=release['native_update'][side]
paths={'exam-agent':'/usr/local/sbin/exam-agent','examctl':'/usr/local/sbin/examctl','exam-login':'/usr/local/libexec/exam-login','exam-info':'/usr/local/bin/exam-info'}
for name,path in paths.items():
 info=Path(path).lstat()
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o755 and digest(path)==expected['binary_sha256'][name]
roles=[]
for name in ('exam-agent.service','exam-deadline-watchdog.service','exam-source-setup.service'):
 reply=subprocess.run(['systemctl','show',name,'--property=MainPID,ActiveState'],capture_output=True,text=True,check=True,timeout=10)
 values=dict(line.split('=',1) for line in reply.stdout.splitlines())
 pid=int(values['MainPID'])
 assert values['ActiveState']=='active' and pid>1
 assert Path('/proc/'+str(pid)+'/cgroup').read_text()=='0::/system.slice/'+name+'\n'
 exe=digest('/proc/'+str(pid)+'/exe')
 assert exe==expected['binary_sha256']['examctl' if name=='exam-source-setup.service' else 'exam-agent']
 roles.append({'unit':name,'pid':pid})
source=next(row['pid'] for row in roles if row['unit']=='exam-source-setup.service')
print(json.dumps({'guard':'PASS','host':'private-native-install-qualification','fixture':True,'production_writes':False,'phase':'after-cli','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'history_sha256':history,'config_sha256':digest(config_path),'cli_config_sha256':digest('/etc/exam-agent/examctl.json'),
 'installed_cli_sha256':digest(paths['examctl']),'worker_cli_sha256':digest('/proc/'+str(source)+'/exe'),
 'native_roles':roles,'relay_pid':0,'relay_sha256':'0'*64}))
'''


def native_install_failure(config, phase, result):
    """Bounded read-only diagnostics, only for this synthetic private guest."""
    native_install_context()
    deadline = time.monotonic() + 25
    report = {'phase': phase, 'adapter_exit': result.returncode, 'private_fixture': True,
              'installed': {}, 'services': {}}
    def capture(command, maximum=5):
        remaining = min(maximum, deadline - time.monotonic())
        if remaining <= .1:
            return {'unavailable': 'diagnostic budget exhausted'}
        try:
            value = subprocess.run(command, capture_output=True, text=True, timeout=remaining)
            return {'exit': value.returncode, 'stdout': value.stdout[:8192]}
        except (OSError, subprocess.TimeoutExpired) as error:
            return {'unavailable': type(error).__name__}
    health = capture([str(NATIVE_PATHS['examctl']), 'health'])
    try:
        body = json.loads(health.pop('stdout', ''))
        health['native_roles'] = body.get('native_roles')
        health['execution_policy_support'] = body.get('execution_policy_support')
    except (ValueError, TypeError):
        health['invalid_or_unavailable_json'] = True
    report['health'] = health
    for name, path in NATIVE_PATHS.items():
        try:
            info = path.stat()
            report['installed'][name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                        'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode)}
        except OSError as error:
            report['installed'][name] = {'unavailable': type(error).__name__}
    for service in NATIVE_SERVICES:
        observed = capture(['systemctl', 'show', service, '--property=MainPID,ActiveState,Result,ExecStart'])
        if 'stdout' in observed:
            observed['properties'] = dict(line.split('=', 1) for line in observed.pop('stdout').splitlines())
            pid = int(observed['properties'].get('MainPID') or 0)
            if pid > 1:
                try:
                    executable = Path('/proc') / str(pid) / 'exe'
                    info = executable.stat()
                    observed['loaded'] = {'path': os.readlink(executable), 'sha256': hashlib.sha256(executable.read_bytes()).hexdigest(),
                                          'device': info.st_dev, 'inode': info.st_ino}
                except OSError as error:
                    observed['loaded'] = {'unavailable': type(error).__name__}
        # PID1 messages describe unit lifecycle only; exclude application logs
        # so even a future synthetic error cannot dump credentials or buffers.
        journal = capture(['journalctl', '--no-pager', '-u', service, '_PID=1', '-n', '3', '-o', 'json'], 2)
        messages = []
        for line in journal.pop('stdout', '').splitlines():
            try: messages.append(str(json.loads(line).get('MESSAGE', ''))[:512])
            except ValueError: pass
        observed['manager_messages'] = messages[-3:]
        report['services'][service] = observed
    descriptor = os.open(OUTPUT / 'native-install-failure.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(report, stream); stream.flush(); os.fsync(stream.fileno())
    print('PRIVATE_NATIVE_INSTALL_DIAGNOSTIC', json.dumps(report)[:16384], flush=True)


def qualify_native_install(config):
    """Rehearse the exact four-file adapter in this disposable namespace."""
    marker, checked = native_install_context()
    assert config == checked
    bootstrap = json.loads((OUTPUT / 'native-bootstrap.json').read_text())
    assert bootstrap['nonce'] == marker['native_nonce'] and bootstrap['candidate_sha256'] == marker['native_sha256']
    # Match scriptLoadConfig's real CLI-only schema before the coordinator
    # loads it. An existing but empty object is invalid, unlike an absent file.
    # Both allowed fixture HTTPS origins are loopback and bypass this unused
    # private proxy; no external or production network configuration changes.
    cli_config = Path('/etc/exam-agent/examctl.json')
    if not cli_config.exists():
        descriptor = os.open(cli_config, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump({'https_proxy': 'http://127.0.0.1:9', 'no_proxy': '127.0.0.1,localhost'}, stream)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    # Normal-filesystem preparation changes the private config before this
    # stage. Load source-worker with that exact current config before snapshot.
    subprocess.run(['systemctl', 'restart', 'exam-source-setup.service'], check=True, timeout=25)
    roles = native_role_snapshot(config)
    assert set(roles) == {'agent', 'watchdog'}
    health = None
    until = time.monotonic() + 15
    while True:
        output = subprocess.run(['examctl', 'health'], capture_output=True, text=True, check=True, timeout=20)
        health = json.loads(output.stdout)
        if health['execution_policy_support']['supported']:
            break
        assert time.monotonic() < until, 'Initial private cohort did not report actual supported roles'
        time.sleep(.1)
    pids = {}
    for service in NATIVE_SERVICES:
        result = subprocess.run(['systemctl', 'show', service, '--property=MainPID', '--value'], check=True, capture_output=True, text=True, timeout=10)
        pids[service] = int(result.stdout.strip())
        assert pids[service] > 1
    pids['exam-ssh-relay.service'] = 0  # This private guest has no relay.
    before = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in NATIVE_PATHS.items()}
    assert all(before[name] == bootstrap['installed'][name]['sha256'] and before[name] != marker['native_sha256'][name] for name in NATIVE_PATHS)
    stage = OUTPUT / 'native-install-stage'
    stage.mkdir(mode=0o700)
    candidates = stage / 'native'
    candidates.mkdir(mode=0o700)
    for name in NATIVE_PATHS:
        shutil.copyfile(INPUT / name, candidates / name)
        (candidates / name).chmod(0o700)
    def write_private(path, value):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(value); stream.flush(); os.fsync(stream.fileno())
    write_private(stage / 'native-guard.py', NATIVE_FIXTURE_GUARD)
    state = json.loads((Path(config['state']) / 'state.json').read_text())
    release = {
        'schema': 37,
        'native_history_sha256': hashlib.sha256(json.dumps(state['attempts'], sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'native_config_sha256': hashlib.sha256(Path('/etc/exam-agent/agent.json').read_bytes()).hexdigest(),
        'cli_config_sha256': hashlib.sha256(cli_config.read_bytes()).hexdigest(),
        'relay_sha256': '0' * 64,
        'unit_sha256': hashlib.sha256(Path('/etc/systemd/system/exam-source-setup.service').read_bytes()).hexdigest(),
        'old_image_config_id': 'sha256:' + '0' * 64,
        'image_config_id': 'sha256:' + 'b' * 64,
        'revision': 'a' * 40,
        'fast_ui': {'state': str(stage / 'synthetic-web-state')},
        'native_update': {
            'nonce': marker['native_nonce'],
            'before': {'binary_sha256': before, 'worker_cli_sha256': before['examctl'], 'service_pids': pids},
            'after': {'binary_sha256': marker['native_sha256'], 'worker_cli_sha256': marker['native_sha256']['examctl']},
            'guard_sha256': hashlib.sha256(NATIVE_FIXTURE_GUARD.encode()).hexdigest(),
        },
    }
    write_private(stage / 'release.json', json.dumps(release))
    # Avoid consuming the prepared watchdog's small start burst through three
    # rapid private starts (boot, normal-filesystem setup, installation). This
    # fixture wait changes no service settings or production limits.
    spacing = subprocess.run(['systemctl', 'show', 'exam-deadline-watchdog.service', '--property=ExecMainStartTimestampMonotonic,StartLimitIntervalUSec'], check=True, capture_output=True, text=True, timeout=10)
    values = dict(line.split('=', 1) for line in spacing.stdout.splitlines())
    interval = values['StartLimitIntervalUSec'].replace(' ', '')
    parts = re.findall(r'([0-9]+(?:\.[0-9]+)?)(min|ms|us|µs|s|h)', interval)
    assert interval == '0' or ''.join(number + unit for number, unit in parts) == interval
    seconds = sum(float(number) * {'us': .000001, 'µs': .000001, 'ms': .001, 's': 1, 'min': 60, 'h': 3600}[unit] for number, unit in parts)
    assert 0 <= seconds <= 30
    remaining = max(0, seconds + .25 - (time.monotonic() - int(values['ExecMainStartTimestampMonotonic']) / 1000000))
    assert remaining <= 30.25
    if remaining:
        print('PRIVATE_NATIVE_INSTALL_START_SPACING', round(remaining, 3), flush=True)
        time.sleep(remaining)
    results = {}
    for phase in ('guard-before', 'stop', 'backup', 'install', 'start', 'verify', 'guard-after'):
        # This is deliberately a fixture gateway-stop stub, not a claim that
        # this single-container test rehearses the real two-host web fence.
        write_private(stage / 'web-stop.json', json.dumps({'fixture': True, 'nonce': marker['native_nonce'], 'phase': 'WAITING_NATIVE',
            'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'web_state': release['fast_ui']['state'], 'web_status_sha256': '0' * 64, 'web_image_config_id': release['old_image_config_id'],
            'revision': release['revision'], 'image_config_id': release['image_config_id'], 'native_binary_sha256': marker['native_sha256'],
            'web_stopped': True, 'web_fenced': True}))
        result = subprocess.run(['/usr/bin/python3', str(INPUT / 'deploy-native-cohort'), '--stage', str(stage), '--fixture', phase],
                                capture_output=True, text=True, timeout=110 if phase == 'backup' else 100)
        if result.returncode:
            print('PRIVATE_NATIVE_INSTALL_FAILURE', phase, result.stdout[-4096:], result.stderr[-8192:], flush=True)
            try:
                native_install_failure(config, phase, result)
            except Exception as error:
                print('PRIVATE_NATIVE_INSTALL_DIAGNOSTIC_UNAVAILABLE', type(error).__name__, flush=True)
        result.check_returncode()
        results[phase] = json.loads(result.stdout)
    transition = results['verify']
    assert transition['phase'] == 'NATIVE_MATCHED_VERIFIED' and transition['nonce'] == marker['native_nonce']
    assert transition['binary_sha256'] == marker['native_sha256']
    assert all(transition['service_pids'][service] != pids[service] and transition['service_pids'][service] > 1 for service in NATIVE_SERVICES)
    assert transition['service_pids']['exam-ssh-relay.service'] == 0
    for name, path in NATIVE_PATHS.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == marker['native_sha256'][name]
        current = path.stat()
        previous = bootstrap['installed'][name]
        assert (current.st_dev, current.st_ino) != (previous['device'], previous['inode'])
    assert results['guard-after']['host'] == 'private-native-install-qualification' and results['guard-after']['policy_supported']
    assert results['guard-before']['phase'] == 'before-native' and results['guard-after']['phase'] == 'after-native'
    write_private(OUTPUT / 'native-install-proof.json', json.dumps({'fixture_gateway_stop_stub': True, 'before_same_code_with_distinct_ELF_footer': True, 'results': results}))
    print('PRIVATE_NATIVE_INSTALL_ADAPTER_OK all_four_files_replaced=true all_three_roles_reloaded=true', flush=True)


def normal_filesystem_settings(config, sockets):
    """Match the production model, using ONLY this disposable guest's root."""
    hidden = set(config.get('host_filesystem_hidden_paths', []))
    if config['work'].startswith('/srv/exam-workspace/'):
        hidden.add('/srv/exam-workspace')
    # Same security rule as install-host-filesystem: named service endpoints
    # outside private runtime/home mounts need explicit data-directory masks,
    # never a tool allowlist or a hidden program/configuration directory.
    for socket in sockets:
        path = Path(socket)
        if not path.is_absolute():
            continue
        if any(path.is_relative_to(base) for base in ('/run', '/tmp', '/var/tmp', '/home', '/root')):
            continue
        parent = path.parent
        if not parent.is_relative_to('/var') or parent == Path('/var'):
            raise RuntimeError('Review unexpected guest service socket before normal-filesystem qualification')
        hidden.add(str(parent))
    return {**config, 'host_filesystem': True, 'rootfs': '/',
            'host_filesystem_hidden_paths': sorted(hidden)}


def verify_finished_guest(state, profile, plan=None, pin=None, now=0):
    """Only the completed saved-work test intentionally ends with its new hold."""
    held = [a for a in state['attempts'].values() if a.get('access_state') == 'HELD']
    expected = None
    if profile == 'retained-policy':
        assert plan and pin and plan['action'] == 'release' and plan['status'] == 'CONSUMED'
        assert pin['phase'] == 'released' and len(pin['consumers']) == 1
        assert len(held) == 1 and held[0]['id'] == pin['consumers'][0]
        expected = held[0]
        source = state['attempts'][plan['source']['attempt']]
        assert source['state'] == 'COMPLETED' and source['protected'] and source['access_state'] == 'RELEASED'
        assert source['checksum'] == plan['source']['checksum']
        assert expected['state'] == 'COMPLETED' and expected['protected'] and expected['checksum']
        assert expected['policy_state'] == 'HELD' and not expected.get('policy_error') and not expected.get('access_error')
        assert expected['exam'] == plan['exam'] and expected['username'] == plan['username'] == 'examq'
        assert expected['uid'] == plan['uid'] == source['uid'] and expected['grant'] == plan['grant']
        assert expected['settings'] == plan['settings'] and expected['settings']['duration'] == 5400
        assert expected['start'] > source['start'] and expected['deadline'] == expected['original_deadline'] > now
        assert expected['deadline'] - expected['start'] == 5400000
        assert expected['workspace']['source'] == dict(kind='saved', **plan['source'])
        assert expected['workspace']['recovery_hash'] == pin['retention_hash']
    assert all(a['state'] in ('COMPLETED', 'CANCELLED_BEFORE_START')
               and (a.get('access_state') != 'HELD' or a is expected)
               and (a.get('policy_state', 'NORMAL') == 'NORMAL' or a is expected)
               for a in state['attempts'].values()), 'Guest restrictions remain unresolved'


def prepare_normal_filesystem(config):
    state = json.loads((Path(config['state']) / 'state.json').read_text())
    assert all(a['state'] in ('COMPLETED', 'CANCELLED_BEFORE_START')
               and a.get('access_state') != 'HELD'
               and a.get('policy_state', 'NORMAL') == 'NORMAL'
               for a in state['attempts'].values()), 'Guest configuration requires an idle fixture'
    # These calls are inside pinned private namespaces; never stop a host unit.
    units = ('exam-reconcile.timer', 'exam-reconcile.service',
             'exam-agent.service', 'exam-deadline-watchdog.service')
    restart = []
    for unit in units:
        loaded = subprocess.run(['systemctl', 'show', unit, '--property=LoadState', '--value'],
                                capture_output=True, text=True, check=True, timeout=10)
        if loaded.stdout.strip() != 'loaded':
            continue
        active = subprocess.run(['systemctl', 'is-active', '--quiet', unit], timeout=10)
        if active.returncode == 0 and unit != 'exam-reconcile.service':
            restart.append(unit)
        subprocess.run(['systemctl', 'stop', unit], check=True, timeout=30)
    sockets = []
    for line in Path('/proc/net/unix').read_text().splitlines():
        fields = line.split()
        if len(fields) >= 8 and fields[7].startswith('/'):
            sockets.append(str(Path(' '.join(fields[7:])).resolve()))
    proposed = normal_filesystem_settings(config, sockets)
    for directory in ('/work', '/materials', '/home/student'):
        path = Path(directory)
        path.mkdir(mode=0o755, exist_ok=True)
        assert path.is_dir() and not path.is_symlink(), 'Unsafe guest mount destination'
    path = Path('/etc/exam-agent/agent.json')
    descriptor, temporary = tempfile.mkstemp(prefix='.qualification-config-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(proposed, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    # Inventory public commands from the SAME root that students will receive.
    # It is test material, not an allowlist, and cannot modify installed software.
    inventory = []
    for directory in ('/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin',
                      '/usr/games', '/usr/local/games'):
        parent = Path(directory)
        if not parent.is_dir():
            continue
        for entry in parent.iterdir():
            try:
                info = entry.stat()
                if stat.S_ISREG(info.st_mode) and info.st_mode & 0o001:
                    inventory.append(str(entry))
                    assert len(inventory) <= 20000, 'Guest command inventory exceeds bounds'
            except FileNotFoundError:
                continue
    starter = Path(config['templates']) / 'qualification/work'
    assert starter.is_dir() and not starter.is_symlink()
    (starter / 'qualification-command-inventory.txt').write_text('\n'.join(sorted(inventory)) + '\n')
    subprocess.run(['systemctl', 'start', *reversed(restart)], check=True, timeout=45)
    print('NORMAL_FILESYSTEM_FIXTURE_READY public_commands=' + str(len(inventory)), flush=True)
    return proposed


def monitoring_owner_command():
    # This is a compiled Go TEST executable, never an installed command or gate.
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestMonitoringSSHProcessGuest$', '-test.v', '-test.count=5',
            '-test.timeout=60s']


def native_role_snapshot(config):
    """Positive direct protocol/peer stage before using health as the oracle."""
    result = {}
    for role, path, unit in (
            ('agent', config['socket'], 'exam-agent.service'),
            ('watchdog', str(Path(config['state']) / 'watchdog-role.sock'), 'exam-deadline-watchdog.service')):
        until = time.monotonic() + 10
        while True:
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                    connection.settimeout(2)
                    connection.connect(path)
                    pid, uid, gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
                    assert pid > 1 and uid == gid == 0
                    assert Path('/proc/' + str(pid) + '/cgroup').read_text() == '0::/system.slice/' + unit + '\n'
                    nonce = uuid.uuid4().hex + uuid.uuid4().hex
                    connection.sendall(json.dumps({'native_role_nonce': nonce}).encode() + b'\n')
                    data = b''
                    while True:
                        chunk = connection.recv(4097 - len(data))
                        if not chunk:
                            break
                        data += chunk
                        assert len(data) <= 4096
                    reply = json.loads(data)
                    assert set(reply) == {'purpose', 'role', 'nonce', 'boot', 'config_hash', 'retained_enabled'}
                    assert reply['purpose'] == 'native-loaded-role/v2' and reply['role'] == role and reply['nonce'] == nonce
                    assert isinstance(reply['retained_enabled'], bool)
                    assert reply['boot'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                    assert len(reply['config_hash']) == 64
                    executable = Path('/proc/' + str(pid) + '/exe').stat()
                    result[role] = {'hash': reply['config_hash'], 'exe': (executable.st_dev, executable.st_ino), 'pid': pid, 'retained_enabled':reply['retained_enabled']}
                break
            except (ConnectionError, FileNotFoundError, socket.timeout):
                if time.monotonic() >= until:
                    raise
                time.sleep(.05)
    return result


def restart_guest_watchdog(stage):
    # Intentionally replacing an idle synthetic service repeatedly must not
    # exhaust its real start-rate limit. Do not reset/disable that protection.
    unit = 'exam-deadline-watchdog.service'
    properties = subprocess.run(['systemctl', 'show', unit,
                                 '--property=StartLimitIntervalUSec,ExecMainStartTimestampMonotonic'],
                                capture_output=True, text=True, check=True, timeout=10)
    values = dict(line.split('=', 1) for line in properties.stdout.splitlines())
    interval = values['StartLimitIntervalUSec'].replace(' ', '')
    parts = re.findall(r'([0-9]+(?:\.[0-9]+)?)(min|ms|us|µs|s|h)', interval)
    assert interval == '0' or ''.join(number + unit for number, unit in parts) == interval, 'Unknown private service start-limit duration'
    seconds = sum(float(number) * {'us': .000001, 'µs': .000001, 'ms': .001, 's': 1, 'min': 60, 'h': 3600}[unit] for number, unit in parts)
    assert 0 <= seconds <= 30, 'Private restart fixture requires an explicitly bounded start-rate interval'
    last = int(values['ExecMainStartTimestampMonotonic']) / 1000000
    remaining = max(0, seconds + .25 - (time.monotonic() - last)) if last else 0
    assert remaining <= 30.25
    if remaining:
        print('PRIVATE_WATCHDOG_RESTART_SPACING', stage, round(remaining, 3), flush=True)
        time.sleep(remaining)
    result = subprocess.run(['systemctl', 'restart', unit], capture_output=True, text=True, timeout=30)
    if result.returncode:
        diagnostics = subprocess.run(['systemctl', 'show', unit,
                                      '--property=Result,ExecMainCode,ExecMainStatus,ActiveState,SubState,NRestarts,StartLimitIntervalUSec,StartLimitBurst'],
                                     capture_output=True, text=True, timeout=10)
        print('PRIVATE_WATCHDOG_RESTART_FAILURE', stage, result.stdout[:1024], result.stderr[:2048], diagnostics.stdout[:4096], flush=True)
        result.check_returncode()


@contextmanager
def guest_watchdog_override(executable, config_path='/etc/exam-agent/agent.json'):
    """Only this guarded disposable guest, before any exam has started."""
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount()
    marker = json.loads((INPUT / 'run.json').read_text())
    assert marker['profile'] in ('retained-policy', 'loaded-roles') and marker['username'] == 'examq'
    config = json.loads(Path('/etc/exam-agent/agent.json').read_text())
    state = json.loads((Path(config['state']) / 'state.json').read_text())
    assert all(a['state'] in ('COMPLETED', 'CANCELLED_BEFORE_START') or (a['state'] == 'PREPARING' and not a['start']) for a in state['attempts'].values())
    assert executable.startswith('/') and config_path.startswith('/') and all(c not in executable + config_path for c in (' ', '\n', '\r'))
    parent = Path('/etc/systemd/system/exam-deadline-watchdog.service.d')
    parent.mkdir(mode=0o755, exist_ok=True)
    override = parent / ('99-private-role-check-' + uuid.uuid4().hex + '.conf')
    descriptor = os.open(override, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        identity = os.fstat(output.fileno())
        output.write('[Service]\nExecStart=\nExecStart=' + executable + ' -config ' + config_path + ' -watchdog\n')
    try:
        subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=15)
        restart_guest_watchdog('substitute')
        yield
    finally:
        current = override.lstat()
        assert (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino)
        override.unlink()  # Exact newly owned private-guest drop-in only.
        subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=15)
        restart_guest_watchdog('restore')


def qualify_loaded_role_cli(config):
    def health(expected, issue=None):
        output = subprocess.run(['examctl', 'health'], capture_output=True, text=True, check=True, timeout=45)
        roles = json.loads(output.stdout)['native_roles']
        assert roles['observation_only'] and roles['retained_enabled'] == (expected and qualified) and roles['complete'] == expected, roles
        assert (roles['roles'] == ['agent', 'watchdog'] and not roles['issues']) if expected else (not roles['roles'] and roles['issues'])
        if issue:
            assert any(issue in message for message in roles['issues']), roles
    original = native_role_snapshot(config)
    assert original['agent']['hash'] == original['watchdog']['hash'] and original['agent']['exe'] == original['watchdog']['exe']
    qualified = original['agent']['retained_enabled']
    assert qualified == original['watchdog']['retained_enabled']
    health(True)
    private = Path(tempfile.mkdtemp(prefix='qualification-native-role-', dir='/run'))
    changed = {**config, 'terminal_recording_limit_mib': 2 if config.get('terminal_recording_limit_mib') == 1 else 1}
    candidate = private / 'watchdog.json'
    candidate.write_text(json.dumps(changed)); candidate.chmod(0o600)
    with guest_watchdog_override('/usr/local/sbin/exam-agent', str(candidate)):
        mismatch = native_role_snapshot(config)
        assert mismatch['agent']['exe'] == mismatch['watchdog']['exe'] and mismatch['agent']['hash'] != mismatch['watchdog']['hash']
        health(False, 'watchdog loaded configuration mismatch')
    native_role_snapshot(config); health(True)
    copy = private / 'agent-copy'
    shutil.copyfile(INPUT / 'exam-agent', copy); copy.chmod(0o700)
    original_file = Path('/usr/local/sbin/exam-agent').stat()
    copied_file = copy.stat()
    assert (copied_file.st_dev, copied_file.st_ino) != (original_file.st_dev, original_file.st_ino)
    assert hashlib.sha256(copy.read_bytes()).digest() == hashlib.sha256((INPUT / 'exam-agent').read_bytes()).digest()
    with guest_watchdog_override(str(copy)):
        mismatch = native_role_snapshot(config)
        assert mismatch['agent']['hash'] == mismatch['watchdog']['hash'] and mismatch['agent']['exe'] != mismatch['watchdog']['exe']
        health(False, 'watchdog loaded executable mismatch')
    native_role_snapshot(config); health(True)
    # Reserved legacy names are created only in this disposable guest, after
    # proving neither unit already exists. Never stop an installed/unknown owner.
    for unit in ('exam-agent-live-upgrade.service', 'exam-agent-deferred-recovery.service'):
        marker = json.loads((INPUT / 'run.json').read_text())
        assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn' and INPUT.is_mount() and OUTPUT.is_mount()
        assert marker['profile'] in ('retained-policy', 'loaded-roles') and marker['username'] == 'examq'
        existing = subprocess.run(['systemctl', 'show', unit, '--property=LoadState', '--value'], capture_output=True, text=True, timeout=10)
        assert existing.returncode in (0, 4) and existing.stdout.strip() == 'not-found', 'Refuse to replace an existing legacy owner'
        subprocess.run(['systemd-run', '--quiet', '--collect', '--service-type=exec', '--unit=' + unit,
                        '--property=MemoryMax=32M', '--property=MemorySwapMax=0', '--property=TasksMax=8',
                        '--property=RuntimeMaxSec=60s', '--', '/bin/sleep', '55'], check=True, timeout=10)
        handle = None
        try:
            pid = int(subprocess.run(['systemctl', 'show', unit, '--property=MainPID', '--value'], capture_output=True, text=True, check=True, timeout=10).stdout.strip())
            assert pid > 1 and Path('/proc/' + str(pid) + '/cgroup').read_text() == '0::/system.slice/' + unit + '\n'
            directory = Path('/sys/fs/cgroup/system.slice') / unit
            events = dict(line.split() for line in (directory / 'cgroup.events').read_text().splitlines())
            assert events['populated'] == '1'
            handle = os.pidfd_open(pid)
            lifetime = select.poll(); lifetime.register(handle, select.POLLIN)
            assert not lifetime.poll(0), 'Legacy refusal fixture lacks a positively live pinned process'
            health(False, unit + ' still has live/unverified processes')
            assert not lifetime.poll(0), 'Legacy process exited before the health refusal oracle'
        finally:
            subprocess.run(['systemctl', 'stop', unit], check=True, timeout=15)
            if handle is not None:
                assert lifetime.poll(2000), 'Owned synthetic legacy process did not positively exit'
                os.close(handle)
        native_role_snapshot(config); health(True)
    print('PASS: actual compiled health observes qualified loaded support, refuses positively observed config/executable mismatch and recovers after private-guest repair; host installation unchanged', flush=True)
    print('PASS: actual compiled health refuses both positively populated temporary-writer cgroups and recovers only after the exact newly owned guest processes exit', flush=True)


def qualify_execution_policy_roles(config):
    """Actual shipped source-worker unit, solely in this guarded overlay."""
    marker = json.loads((INPUT / 'run.json').read_text())
    proof = json.loads((OUTPUT / 'native-install-proof.json').read_text()) if marker.get('profile') == 'native-install' else None
    require_execution_policy_profile(marker, 'examq', proof)
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn' and INPUT.is_mount() and OUTPUT.is_mount()
    unit = 'exam-source-setup.service'
    receipt = Path(config['state']) / 'source-worker-policy-role.json'
    def health(expected):
        reply = subprocess.run(['examctl', 'health'], capture_output=True, text=True, check=True, timeout=45)
        support = json.loads(reply.stdout)['execution_policy_support']
        assert set(support) == {'schema', 'capability', 'observation_only', 'supported', 'observed', 'roles', 'issues'}
        assert support['schema'] == 1 and support['capability'] == 'live-exam-execution-policy-v1' and support['observation_only']
        assert int(time.time()*1000)-120000 < support['observed'] <= int(time.time()*1000)+1000
        assert support['supported'] == expected, support
        assert (support['roles'] == ['agent','watchdog','source-worker'] and not support['issues']) if expected else (not support['roles'] and support['issues'])
    def start():
        subprocess.run(['systemctl', 'start', unit], check=True, timeout=20)
        until = time.monotonic()+10
        while not receipt.exists():
            state = subprocess.run(['systemctl','is-active',unit],capture_output=True,text=True,timeout=5)
            assert state.stdout.strip() in ('active','activating'), state
            assert time.monotonic()<until, 'Loaded coordinator did not publish from actual hardened service context'
            time.sleep(.05)
        pid = int(subprocess.run(['systemctl','show',unit,'--property=MainPID','--value'],capture_output=True,text=True,check=True,timeout=5).stdout.strip())
        assert json.loads(receipt.read_text())['pid'] == pid > 1
        assert Path('/proc/'+str(pid)+'/cgroup').read_text() == '0::/system.slice/'+unit+'\n'
    def stop():subprocess.run(['systemctl','stop',unit],check=True,timeout=20)
    subprocess.run(['systemctl','daemon-reload'],check=True,timeout=10)
    start()
    try:
        health(True)
        original=receipt.read_bytes();receipt.unlink()
        health(False) # A loaded older process has no policy ABI receipt.
        descriptor=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(descriptor,'wb') as stream:stream.write(original);stream.flush();os.fsync(stream.fileno())
        health(True)
        stop();health(False)
        private=Path(tempfile.mkdtemp(prefix='qualification-source-role-',dir='/run'))
        copy=private/'examctl-copy';shutil.copyfile(INPUT/'examctl',copy);copy.chmod(0o700)
        parent=Path('/etc/systemd/system')/(unit+'.d');parent.mkdir(mode=0o755,exist_ok=True)
        override=parent/('99-private-policy-'+uuid.uuid4().hex+'.conf')
        descriptor=os.open(override,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(descriptor,'w') as stream:
            identity=os.fstat(stream.fileno())
            stream.write('[Service]\nExecStart=\nExecStart='+str(copy)+' web grants source-worker --config /etc/exam-agent/agent.json\n')
        try:
            subprocess.run(['systemctl','daemon-reload'],check=True,timeout=10)
            start();health(False) # Same bytes, different actual loaded inode.
            stop()
        finally:
            current=override.lstat();assert (current.st_dev,current.st_ino)==(identity.st_dev,identity.st_ino)
            override.unlink();subprocess.run(['systemctl','daemon-reload'],check=True,timeout=10)
        start();health(True)
        print('PASS: actual hardened saved-work worker publishes healthy loaded policy support; missing/stopped/different loaded inode refuses; exact guest repair restores support',flush=True)
    finally:stop()


def retained_role_override(role):
    assert role in ('Agent', 'Watchdog'), 'Unknown private test role'
    return ('[Service]\nExecStart=\nExecStart=' + str(INPUT / 'core-qualification.test') +
            ' -test.run=^TestRetainedPolicy' + role + 'Guest$ -test.timeout=12m\n' +
            'Environment=EXAM_RETAINED_POLICY_GUEST=1\n')


def prepare_retained_roles(qualify_roles=True):
    # Called only AFTER main's complete private-container/mount/config guards.
    # TestMain dispatches the actual native role functions/factories. No desktop
    # ancestry, UID inventory, cgroup, filesystem or cleanup substitute is used.
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount()
    marker = json.loads((INPUT / 'run.json').read_text())
    assert marker['profile'] == 'retained-policy' and marker['username'] == 'examq'
    if marker.get('release_native'):
        assert marker.get('driver') == 'browser'
        config = json.loads(Path('/etc/exam-agent/agent.json').read_text())
        installed = Path('/usr/local/sbin/exam-agent').stat()
        roles = native_role_snapshot(config)
        assert all(role['retained_enabled'] and role['exe'] == (installed.st_dev, installed.st_ino) for role in roles.values())
        health = json.loads(subprocess.run(['examctl', 'health'], capture_output=True, text=True, check=True, timeout=45).stdout)['native_roles']
        assert health['observation_only'] and health['complete'] and health['retained_enabled'] and health['roles'] == ['agent','watchdog'] and not health['issues']
        print('PUBLIC_RELEASE_NATIVE_ROLES_VERIFIED no_test_override=true', flush=True)
        return
    if qualify_roles:
        qualify_loaded_role_cli(json.loads(Path('/etc/exam-agent/agent.json').read_text()))
    services = ('exam-agent.service', 'exam-deadline-watchdog.service')
    subprocess.run(['systemctl', 'stop', *services], check=True, timeout=45)
    for service, role in zip(services, ('Agent', 'Watchdog')):
        parent = Path('/etc/systemd/system') / (service + '.d')
        parent.mkdir(mode=0o755, exist_ok=True)
        override = parent / '90-private-retained-test.conf'
        descriptor = os.open(override, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write(retained_role_override(role))
    subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=30)
    subprocess.run(['systemctl', 'start', *services], check=True, timeout=45)


def monitoring_freeze_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestMonitoringFreezePTYGuest$', '-test.v', '-test.count=5',
            '-test.timeout=60s']


def monitoring_asyncio_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestMonitoringAsyncIOGuest$', '-test.v', '-test.count=3',
            '-test.timeout=120s']


def monitoring_asyncio_stopped_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestMonitoringAsyncIOStoppedGuest$', '-test.v', '-test.count=3',
            '-test.timeout=120s']


def monitoring_editor_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestMonitoringEditorGuest$', '-test.v', '-test.count=10',
            '-test.timeout=60s']


def template_catalog_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestTemplateCatalogSystemManagerGuest$', '-test.v', '-test.count=1',
            '-test.timeout=240s']


def collection_pool_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestCollectionPoolReadinessGuest$', '-test.v', '-test.count=3',
            '-test.timeout=90s']


def writer_threads_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestWriterThreadGroupGuest$', '-test.v', '-test.count=5',
            '-test.timeout=90s']


def monitoring_thread_tty_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestMonitoringThreadTTYGuest$', '-test.v', '-test.count=10',
            '-test.timeout=90s']


def pane_ack_command():
    return [str(INPUT / 'core-qualification.test'),
            '-test.run=^TestPaneAcknowledgementGuest$', '-test.v', '-test.count=3',
            '-test.timeout=90s']


def main():
    assert os.geteuid() == 0
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount(), 'Missing private test mounts'
    config = json.loads(Path('/etc/exam-agent/agent.json').read_text())
    guards = json.loads(Path(config['guard_report']).read_text())
    assert guards.get('fixture', '').startswith('Private qualification')
    assert config['callback_url'] == 'https://127.0.0.1:9444'
    assert not config.get('functional_test_account')
    assert config.get('temporary_account_policy')
    capabilities = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    assert int(capabilities['CapBnd'], 16) & (1 << 25) == 0, 'Guest must not be able to change the shared host clock'
    settings = json.loads((INPUT / 'run.json').read_text())
    username = settings['username']
    account = pwd.getpwnam(username)
    assert account.pw_uid >= 1000 and account.pw_shell in ('/bin/bash', '/bin/sh')
    assert any(line.startswith(username + ':') for line in Path('/etc/passwd').read_text().splitlines()), 'Synthetic guest-local account required'
    for command in REQUIRED:
        if not shutil.which(command):
            print('COMMAND_NOT_FOUND: ' + command, flush=True)
            return 127
    if settings.get('profile') == 'retained-policy' and not shutil.which('nano'):
        print('COMMAND_NOT_FOUND: nano', flush=True)
        return 127
    config = prepare_normal_filesystem(config)
    if settings.get('driver') == 'browser':
        from browser_bridge import run_guest
        return run_guest(config, prepare_retained_roles, native_role_snapshot)
    if settings.get('profile') == 'native-install':
        qualify_native_install(config)
        if settings.get('native_relay'):
            subprocess.run(['/usr/bin/python3', str(INPUT / 'qualify_relay_install.py')], check=True, timeout=240)
        qualify_execution_policy_roles(config)
        profiles = (['--execution-policy'],)
    elif settings.get('profile') == 'execution-policy':
        qualify_execution_policy_roles(config)
        profiles = (['--execution-policy'],)
    elif settings.get('profile') == 'loaded-roles':
        qualify_loaded_role_cli(config)
        profiles = ()
    elif settings.get('profile') == 'monitoring-owner':
        assert username == 'examq', 'Exact synthetic owner fixture required'
        # Stop only this disposable overlay's agent before the test listens on
        # its gate path. The test refuses to replace an existing socket and
        # refuses every ordinary execution request; it never starts exam work.
        subprocess.run(['systemctl', 'stop', 'exam-agent.service'], check=True, timeout=30)
        try:
            environment = {**os.environ, 'EXAM_MONITORING_SSH_GUEST': '1'}
            result = subprocess.run(monitoring_owner_command(), env=environment, timeout=75)
            if result.returncode:
                return result.returncode
        finally:
            subprocess.run(['systemctl', 'start', 'exam-agent.service'], check=True, timeout=30)
        profiles = ()
    elif settings.get('profile') == 'monitoring-freeze':
        assert username == 'examq', 'Exact synthetic freeze fixture required'
        # No gate socket replacement or agent action for this profile. All
        # workload scopes/UIDs/files are owned disposable-guest fixtures.
        environment = {**os.environ, 'EXAM_MONITORING_FREEZE_GUEST': '1'}
        result = subprocess.run(monitoring_freeze_command(), env=environment, timeout=75)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'monitoring-async-io':
        assert username == 'examq', 'Exact synthetic async-IO fixture required'
        environment = {**os.environ, 'EXAM_MONITORING_ASYNCIO_GUEST': '1'}
        result = subprocess.run(monitoring_asyncio_command(), env=environment, timeout=150)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'monitoring-async-io-stopped':
        assert username == 'examq', 'Exact synthetic async-IO stop fixture required'
        environment = {**os.environ, 'EXAM_MONITORING_ASYNCIO_STOPPED_GUEST': '1'}
        result = subprocess.run(monitoring_asyncio_stopped_command(), env=environment, timeout=150)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'monitoring-editor':
        assert username == 'examq', 'Exact synthetic editor fixture required'
        environment = {**os.environ, 'EXAM_MONITORING_EDITOR_GUEST': '1'}
        result = subprocess.run(monitoring_editor_command(), env=environment, timeout=75)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'pane-ack':
        assert username == 'examq', 'Exact synthetic pane-ACK fixture required'
        environment = {**os.environ, 'EXAM_PANE_ACK_GUEST': '1'}
        result = subprocess.run(pane_ack_command(), env=environment, timeout=105)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'monitoring-thread-tty':
        assert username == 'examq', 'Exact synthetic foreground-thread fixture required'
        environment = {**os.environ, 'EXAM_MONITORING_THREAD_TTY_GUEST': '1'}
        result = subprocess.run(monitoring_thread_tty_command(), env=environment, timeout=105)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'writer-threads':
        assert username == 'examq', 'Exact synthetic writer-thread fixture required'
        environment = {**os.environ, 'EXAM_WRITER_THREADS_GUEST': '1'}
        result = subprocess.run(writer_threads_command(), env=environment, timeout=105)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'collection-pool':
        assert username == 'examq', 'Exact synthetic collection-pool fixture required'
        environment = {**os.environ, 'EXAM_COLLECTION_POOL_GUEST': '1'}
        result = subprocess.run(collection_pool_command(), env=environment, timeout=105)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'template-catalog':
        assert username == 'examq', 'Exact synthetic catalog fixture required'
        environment = {**os.environ, 'EXAM_TEMPLATE_CATALOG_GUEST': '1'}
        result = subprocess.run(template_catalog_command(), env=environment, timeout=255)
        if result.returncode:
            return result.returncode
        profiles = ()
    elif settings.get('profile') == 'timed-owner':
        assert username == 'examq', 'Exact synthetic timed-owner fixture required'
        profiles = (['--timed-owner'],)
    elif settings.get('profile') == 'framed-owner':
        assert username == 'examq', 'Exact synthetic framed-owner fixture required'
        profiles = (['--framed-owner'],)
    elif settings.get('profile') == 'retained-policy':
        assert username == 'examq', 'Exact synthetic retained-policy fixture required'
        prepare_retained_roles()
        profiles = (['--retained-policy'],)
    else:
        profiles = (['--handoff-only'], ['--setup-only'], [])
    # Commands execute only in the network/PID/mount namespace of this overlay.
    if settings.get('profile', 'enforcement') == 'worker-isolation' or settings.get('cleanup_peer'):
        assert not settings.get('cleanup_peer') or settings.get('profile') == 'retained-policy'
        peer, uid = 'examqpeer', 29979
        for entry in pwd.getpwall():
            assert entry.pw_name != peer and entry.pw_uid != uid, 'Synthetic peer identity already exists'
        # Clone only the disposable guest account's local authentication policy,
        # never any host/directory identity or production credentials.
        shadow = next(line.split(':')[1] for line in Path('/etc/shadow').read_text().splitlines() if line.startswith(username + ':'))
        subprocess.run(['useradd', '--create-home', '--uid', str(uid), '--shell', '/bin/bash', '--password', shadow, peer], check=True, timeout=15)
        # This prepared fixture's sshd deliberately reads root-owned keys here,
        # not ~/.ssh. Copy only the synthetic fixture's public authorization.
        authorized = Path('/etc/ssh/qualification-keys') / peer
        assert not authorized.exists(), 'Synthetic peer authorization already exists'
        authorized.write_bytes((authorized.parent / username).read_bytes())
        authorized.chmod(0o644)
        profiles = ((['--retained-policy'] if settings.get('cleanup_peer') else []) + ['--worker-isolation', '--peer', peer],)
    for flags in profiles:
        command = ['/usr/bin/python3', str(INPUT / 'linux_qualification.py'),
                   '--username', username, *flags]
        result = subprocess.run(command, timeout=660)
        if result.returncode:
            subprocess.run(['systemctl', '--no-pager', 'status', 'ssh.service', 'exam-agent.service'], timeout=15)
            return result.returncode
    state = json.loads((Path(config['state']) / 'state.json').read_text())
    plan, pin = None, None
    if settings.get('profile') == 'retained-policy' and not settings.get('cleanup_peer'):
        plan = json.loads(Path('/run/qualification-saved-source-grant.json').read_text())['plan']
        grant = plan['grant']
        pin = json.loads((Path(config['state']) / 'source-retentions' /
                          (grant['id'] + '-' + str(grant['revision']) + '.json')).read_text())
    import time
    verify_finished_guest(state, 'worker-isolation' if settings.get('cleanup_peer') else settings.get('profile'), plan, pin, int(time.time() * 1000))
    print('OVERLAY_QUALIFICATION_OK', flush=True)
    return 0


if __name__ == '__main__':
    if sys.argv[1:] == ['--native-bootstrap']:
        raise SystemExit(bootstrap_native_install())
    assert len(sys.argv) == 1, 'Unsupported private guest invocation'
    code = 1
    try:
        code = main()
    except Exception:
        traceback.print_exc()
    finally:
        (OUTPUT / 'result.json').write_text(json.dumps({'exit': code}) + '\n')
    raise SystemExit(code)
