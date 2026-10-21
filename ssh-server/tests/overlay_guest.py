#!/usr/bin/env python3
"""Candidate checks INSIDE the disposable overlay, never on the class host."""
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import traceback

INPUT = Path('/run/ssh-exam-qualification-input')
OUTPUT = Path('/run/ssh-exam-qualification-output')
REQUIRED = ('python3', 'systemctl', 'ssh', 'ssh-keygen', 'sftp', 'crontab',
            'su', 'bwrap', 'setpriv', 'systemd-run', 'sshd', 'usermod',
            'gpasswd', 'loginctl', 'sudo', 'nohup', 'sleep', 'ln', 'mkfifo')


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
    # Commands execute only in the network/PID/mount namespace of this overlay.
    for flags in (['--handoff-only'], ['--setup-only'], []):
        command = ['/usr/bin/python3', str(INPUT / 'linux_qualification.py'),
                   '--username', username, *flags]
        result = subprocess.run(command, timeout=660)
        if result.returncode:
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
