#!/usr/bin/env python3
"""Install the dedicated relay without restarting SSH or the exam agent."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def nginx_include(text):
    """Modify exactly the existing csc-sys HTTPS server, preserving other sites."""
    include = "    include /etc/nginx/snippets/exam-ssh-relay.conf;\n"
    if include.strip() in text:
        return text
    lines = text.splitlines(keepends=True)
    start = None
    depth = 0
    matches = []
    for index, line in enumerate(lines):
        clean = line.split("#", 1)[0]
        if start is None and clean.strip() == "server {":
            start = index
        depth += clean.count("{") - clean.count("}")
        if start is not None and depth == 0:
            block = "".join(lines[start:index + 1])
            if "server_name csc-sys.cdm.depaul.edu;" in block and "listen 443 ssl;" in block:
                matches.append(index)
            start = None
    if len(matches) != 1 or depth != 0:
        raise ValueError("expected exactly one existing csc-sys HTTPS server block")
    lines.insert(matches[0], include)
    return "".join(lines)


def run(*args):
    subprocess.run(args, check=True)


def put(path, data, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".exam-relay-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("checksum")
    parser.add_argument("--nginx", type=Path, default=Path("/etc/nginx/sites-available/default"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("run installation with sudo")
    base = Path(__file__).resolve().parent
    binary = args.binary.read_bytes()
    if hashlib.sha256(binary).hexdigest() != args.checksum:
        raise SystemExit("relay binary checksum mismatch")
    nginx = args.nginx.resolve(strict=True)
    st = nginx.stat()
    if st.st_uid != 0 or st.st_mode & 0o022:
        raise SystemExit("nginx configuration must be root-controlled")
    new_nginx = nginx_include(nginx.read_text()).encode()
    config = (base / "config.example.json").read_bytes()
    settings = json.loads(config)
    key = Path("/etc/exam-agent/gateway-signing.pub")
    key_stat = key.stat()
    if key_stat.st_uid != 0 or key_stat.st_mode & 0o022:
        raise SystemExit("existing gateway public key must be root-controlled")
    # Validate the binary/config and actual fixed proxy route before changing nginx.
    with tempfile.TemporaryDirectory(prefix="exam-relay-check-") as temp:
        temporary = dict(settings, public_key=str(key), replay_directory=temp)
        temp_config = Path(temp) / "config.json"
        temp_config.write_text(json.dumps(temporary))
        run(str(args.binary.resolve()), "-config", str(temp_config), "-check")
        run(str(args.binary.resolve()), "-config", str(temp_config), "-probe")
    files = {
        Path("/usr/local/libexec/exam-ssh-relay"): (binary, 0o755),
        Path("/etc/exam-relay/config.json"): (config, 0o644),
        Path("/etc/exam-relay/gateway.pub"): (key.read_bytes(), 0o644),
        Path("/etc/systemd/system/exam-ssh-relay.service"): ((base / "systemd/exam-ssh-relay.service").read_bytes(), 0o644),
        Path("/etc/nginx/snippets/exam-ssh-relay.conf"): ((base / "nginx/exam-ssh-relay.conf").read_bytes(), 0o644),
        nginx: (new_nginx, st.st_mode & 0o777),
    }
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path(tempfile.mkdtemp(prefix=f"{stamp}-relay-", dir="/var/backups/ssh-exam"))
    old = {}
    for i, path in enumerate(files):
        old[path] = (path.read_bytes(), path.stat().st_mode & 0o777) if path.exists() else None
        if old[path] is not None:
            put(backup / str(i), old[path][0], 0o600)
    put(backup / "paths.json", json.dumps([str(p) for p in files]).encode(), 0o600)
    was_active = subprocess.run(["systemctl", "is-active", "--quiet", "exam-ssh-relay"]).returncode == 0
    was_enabled = subprocess.run(["systemctl", "is-enabled", "--quiet", "exam-ssh-relay"], stdout=subprocess.DEVNULL).returncode == 0
    try:
        for path, (data, mode) in files.items():
            put(path, data, mode)
        run("nginx", "-t")
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "exam-ssh-relay")
        run("systemctl", "restart", "exam-ssh-relay")
        run("systemctl", "is-active", "--quiet", "exam-ssh-relay")
        run("systemctl", "reload", "nginx")
    except BaseException:
        subprocess.run(["systemctl", "stop", "exam-ssh-relay"])
        if not was_enabled:
            subprocess.run(["systemctl", "disable", "exam-ssh-relay"])
        for path, content in old.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                put(path, content[0], content[1])
        run("systemctl", "daemon-reload")
        run("nginx", "-t")
        run("systemctl", "reload", "nginx")
        if was_active:
            run("systemctl", "start", "exam-ssh-relay")
        raise
    print(f"Relay installed. Backup: {backup}")


if __name__ == "__main__":
    main()
