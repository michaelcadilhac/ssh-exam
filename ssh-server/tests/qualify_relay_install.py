#!/usr/bin/env python3
"""Five-binary/proxy installation rehearsal, ONLY inside the guarded guest."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

INPUT = Path('/run/ssh-exam-qualification-input')
OUTPUT = Path('/run/ssh-exam-qualification-output')
RUNTIME = Path('/run/ssh-exam-nginx-runtime')
RELAY = Path('/usr/local/libexec/exam-ssh-relay')
SNIPPET = Path('/etc/nginx/snippets/exam-ssh-relay.conf')
TRUST = ('/etc/exam-relay/config.json', '/etc/exam-relay/gateway.pub',
         '/etc/systemd/system/exam-ssh-relay.service')
UNITS = ('exam-agent.service', 'exam-deadline-watchdog.service',
         'exam-source-setup.service', 'exam-ssh-relay.service')

NGINX_WRAPPER = '''#!/usr/bin/python3
import os,sys
root='/run/ssh-exam-nginx-runtime/'
os.execv(root+'ld.so', [root+'ld.so','--library-path',root,root+'nginx','-c','/etc/nginx/nginx.conf',*sys.argv[1:]])
'''
GUARD = '''#!/usr/bin/python3
import hashlib,json,subprocess,sys
from pathlib import Path
stage=Path(sys.argv[1])
reply=json.loads(subprocess.check_output(['/usr/bin/python3',str(stage.parent/'native-base-guard.py'),*sys.argv[1:]],text=True,timeout=25))
release=json.loads((stage/'release.json').read_text())
side='after' if stage.name=='guard-after' else 'before'
expected=release['native_update'][side]['binary_sha256']['exam-ssh-relay']
values=dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show','exam-ssh-relay.service','--property=MainPID,ActiveState'],text=True,timeout=10).splitlines())
pid=int(values['MainPID'])
assert values['ActiveState']=='active' and pid>1
assert Path('/proc/'+str(pid)+'/cgroup').read_text()=='0::/system.slice/exam-ssh-relay.service\\n'
assert hashlib.sha256(Path('/proc/'+str(pid)+'/exe').read_bytes()).hexdigest()==expected
reply.update(relay_pid=pid,relay_sha256=expected)
print(json.dumps(reply))
'''


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, data, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    assert not path.is_symlink()
    path.write_bytes(data.encode() if isinstance(data, str) else data)
    path.chmod(mode)


def run(args, timeout=25):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        print('PRIVATE_RELAY_COMMAND_FAILED', args, result.stdout[-2048:], result.stderr[-4096:], flush=True)
    result.check_returncode()
    return result


def pids():
    return {unit: int(run(['systemctl', 'show', unit, '--property=MainPID', '--value']).stdout.strip()) for unit in UNITS}


def proxy_check():
    deadline = time.monotonic() + 5
    while True:
        try:
            urllib.request.urlopen('http://127.0.0.1:9801/ssh-exam/relay', timeout=2)
        except urllib.error.HTTPError as error:
            # This exact origin refusal comes from the relay. An upstream
            # error or nginx-generated error page cannot qualify the path.
            body = error.read(8192)
            if error.code == 502 and time.monotonic() < deadline:
                time.sleep(.05)
                continue
            assert error.code == 403 and body == b'Forbidden\n', (error.code, body)
            return {'status': error.code, 'bytes': len(body)}
        except urllib.error.URLError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(.05)
            continue
        raise AssertionError('Unauthenticated relay request unexpectedly succeeded')


def main():
    assert os.getuid() == os.geteuid() == 0 and __debug__
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount() and RUNTIME.is_mount()
    marker = json.loads((INPUT / 'run.json').read_text())
    assert marker['profile'] == 'native-install' and marker['username'] == 'examq' and marker['native_relay'] is True
    assert digest(INPUT / 'exam-ssh-relay') == marker['relay_sha256']
    for name, value in marker['nginx_runtime_sha256'].items():
        assert Path(name).name == name and digest(RUNTIME / name) == value
    config = json.loads(Path('/etc/exam-agent/agent.json').read_text())
    assert config['callback_url'] == 'https://127.0.0.1:9444'
    assert json.loads(Path(config['guard_report']).read_text())['fixture'].startswith('Private qualification')
    write(RELAY, (INPUT / 'exam-ssh-relay').read_bytes() + b'\nPRIVATE_RELAY_BEFORE\n', 0o755)
    write(TRUST[1], Path(config['gateway_public_key']).read_bytes(), 0o644)
    write(TRUST[0], json.dumps({'listen': '127.0.0.1:9082', 'origin': 'https://127.0.0.1:9444',
          'audience': 'private-relay', 'public_key': TRUST[1], 'dial_target': '127.0.0.1:22',
          'replay_directory': '/var/lib/exam-ssh-relay'}), 0o644)
    write(TRUST[2], '[Service]\nType=simple\nDynamicUser=yes\nStateDirectory=exam-ssh-relay\nStateDirectoryMode=0700\n'
          'ExecStart=/usr/local/libexec/exam-ssh-relay -config /etc/exam-relay/config.json\n'
          'ProtectSystem=strict\nProtectHome=yes\nNoNewPrivileges=yes\nTimeoutStopSec=10\n', 0o644)
    write('/usr/sbin/nginx', NGINX_WRAPPER, 0o755)
    nginx_config = 'user root;\nerror_log stderr;\npid /run/private-nginx.pid;\nevents {}\nhttp {\n' \
        'access_log off;\nclient_body_temp_path /run/nginx-client;\nproxy_temp_path /run/nginx-proxy;\n' \
        'fastcgi_temp_path /run/nginx-fastcgi;\nuwsgi_temp_path /run/nginx-uwsgi;\nscgi_temp_path /run/nginx-scgi;\n' \
        'server { listen 127.0.0.1:9801; include /etc/nginx/snippets/exam-ssh-relay.conf; }\n}\n'
    write('/etc/nginx/nginx.conf', nginx_config, 0o644)
    write(SNIPPET, '# Private before configuration\n' + (INPUT / 'relay-nginx.conf').read_text(), 0o644)
    write('/etc/systemd/system/nginx.service', '[Service]\nType=simple\nExecStart=/usr/sbin/nginx -g "daemon off;"\n'
          'ExecReload=/usr/sbin/nginx -s reload\nTimeoutStopSec=10\n', 0o644)
    run(['systemctl', 'daemon-reload'])
    run(['/usr/sbin/nginx', '-t'])
    run(['systemctl', 'start', 'exam-ssh-relay.service', 'nginx.service'])
    initial_proxy = proxy_check()
    stage = OUTPUT / 'relay-install-stage'
    stage.mkdir(mode=0o700)
    (stage / 'native').mkdir(mode=0o700)
    previous = OUTPUT / 'native-install-stage'
    release = json.loads((previous / 'release.json').read_text())
    write(stage / 'native-base-guard.py', (previous / 'native-guard.py').read_bytes())
    write(stage / 'native-guard.py', GUARD)
    write(stage / 'relay-nginx.conf', (INPUT / 'relay-nginx.conf').read_bytes())
    paths = {'exam-agent': '/usr/local/sbin/exam-agent', 'examctl': '/usr/local/sbin/examctl',
             'exam-login': '/usr/local/libexec/exam-login', 'exam-info': '/usr/local/bin/exam-info',
             'exam-ssh-relay': str(RELAY)}
    before = {name: digest(path) for name, path in paths.items()}
    after = {**marker['native_sha256'], 'exam-ssh-relay': marker['relay_sha256']}
    for name in paths:
        shutil.copyfile(INPUT / name, stage / 'native' / name)
        (stage / 'native' / name).chmod(0o700)
    original_pids = pids()
    assert all(pid > 1 for pid in original_pids.values())
    release['fast_ui']['reviewed_scope'] = 'disconnect-diagnostics-v1'
    release['fast_ui']['state'] = str(stage / 'synthetic-web-state')
    release['relay_sha256'] = before['exam-ssh-relay']
    release['native_update'].update(
        before={'binary_sha256': before, 'worker_cli_sha256': before['examctl'], 'service_pids': original_pids},
        after={'binary_sha256': after, 'worker_cli_sha256': after['examctl']},
        guard_sha256=digest(stage / 'native-guard.py'),
        relay={'preserve_sha256': {path: digest(path) for path in TRUST},
               'nginx_before_sha256': digest(SNIPPET), 'nginx_after_sha256': digest(INPUT / 'relay-nginx.conf')})
    write(stage / 'release.json', json.dumps(release))
    # Respect the prepared native roles' unchanged start-limit interval.
    time.sleep(11)
    results = {}
    invalid_refusal = None
    for phase in ('guard-before', 'stop', 'backup', 'install', 'start', 'verify', 'guard-after'):
        write(stage / 'web-stop.json', json.dumps({'fixture': True, 'nonce': marker['native_nonce'], 'phase': 'WAITING_NATIVE',
              'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'web_state': release['fast_ui']['state'],
              'web_status_sha256': '0'*64, 'web_image_config_id': release['old_image_config_id'],
              'revision': release['revision'], 'image_config_id': release['image_config_id'],
              'native_binary_sha256': after, 'web_stopped': True, 'web_fenced': True}))
        command = ['/usr/bin/python3', str(INPUT / 'deploy-native-cohort'), '--stage', str(stage), '--fixture', phase]
        if phase == 'install':
            write('/etc/nginx/nginx.conf', nginx_config + '\nprivate_invalid_directive;\n', 0o644)
            refused = subprocess.run(command, capture_output=True, text=True, timeout=100)
            assert refused.returncode != 0 and all(pid == 0 for pid in pids().values()), refused.stdout + refused.stderr
            assert json.loads((stage / 'native-status.json').read_text())['phase'] == 'INSTALLING'
            invalid_refusal = {'returncode': refused.returncode, 'roles_stopped': True}
            write('/etc/nginx/nginx.conf', nginx_config, 0o644)
        result = run(command, timeout=110)
        results[phase] = json.loads(result.stdout)
    transition = results['verify']
    assert transition['binary_sha256'] == after
    assert all(transition['service_pids'][unit] > 1 and transition['service_pids'][unit] != original_pids[unit] for unit in UNITS)
    assert all(digest(path) == value for path, value in release['native_update']['relay']['preserve_sha256'].items())
    assert digest(SNIPPET) == release['native_update']['relay']['nginx_after_sha256']
    final_proxy = proxy_check()
    write(OUTPUT / 'relay-install-proof.json', json.dumps({'results': results, 'invalid_proxy_refusal': invalid_refusal,
          'initial_proxy': initial_proxy, 'final_proxy': final_proxy, 'nginx_runtime_sha256': marker['nginx_runtime_sha256'],
          'production_writes': False}))
    print('PRIVATE_RELAY_INSTALL_OK actual_nginx_reload=true trust_preserved=true refusal_retry=true', flush=True)


if __name__ == '__main__':
    main()
