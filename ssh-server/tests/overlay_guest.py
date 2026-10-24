#!/usr/bin/env python3
"""Candidate checks INSIDE the disposable overlay, never on the class host."""
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import tempfile
import traceback

INPUT = Path('/run/ssh-exam-qualification-input')
OUTPUT = Path('/run/ssh-exam-qualification-output')
REQUIRED = ('python3', 'systemctl', 'ssh', 'ssh-keygen', 'sftp', 'crontab',
            'su', 'bwrap', 'setpriv', 'systemd-run', 'sshd', 'usermod',
            'gpasswd', 'loginctl', 'sudo', 'nohup', 'sleep', 'ln', 'mkfifo', 'useradd')


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


def retained_role_override(role):
    assert role in ('Agent', 'Watchdog'), 'Unknown private test role'
    return ('[Service]\nExecStart=\nExecStart=' + str(INPUT / 'core-qualification.test') +
            ' -test.run=^TestRetainedPolicy' + role + 'Guest$ -test.timeout=12m\n' +
            'Environment=EXAM_RETAINED_POLICY_GUEST=1\n')


def prepare_retained_roles():
    # Called only AFTER main's complete private-container/mount/config guards.
    # TestMain dispatches the actual native role functions/factories. No desktop
    # ancestry, UID inventory, cgroup, filesystem or cleanup substitute is used.
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount()
    marker = json.loads((INPUT / 'run.json').read_text())
    assert marker['profile'] == 'retained-policy' and marker['username'] == 'examq'
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
    if settings.get('profile') == 'monitoring-owner':
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
    if settings.get('profile', 'enforcement') == 'worker-isolation':
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
        profiles = (['--worker-isolation', '--peer', peer],)
    for flags in profiles:
        command = ['/usr/bin/python3', str(INPUT / 'linux_qualification.py'),
                   '--username', username, *flags]
        result = subprocess.run(command, timeout=660)
        if result.returncode:
            subprocess.run(['systemctl', '--no-pager', 'status', 'ssh.service', 'exam-agent.service'], timeout=15)
            return result.returncode
    state = json.loads((Path(config['state']) / 'state.json').read_text())
    assert all(a['state'] in ('COMPLETED', 'CANCELLED_BEFORE_START')
               and a.get('access_state') != 'HELD'
               and a.get('policy_state', 'NORMAL') == 'NORMAL'
               for a in state['attempts'].values()), 'Guest restrictions remain unresolved'
    print('OVERLAY_QUALIFICATION_OK', flush=True)
    return 0


if __name__ == '__main__':
    code = 1
    try:
        code = main()
    except Exception:
        traceback.print_exc()
    finally:
        (OUTPUT / 'result.json').write_text(json.dumps({'exit': code}) + '\n')
    raise SystemExit(code)
