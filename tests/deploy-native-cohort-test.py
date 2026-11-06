#!/usr/bin/env python3
"""Exercise operator CLI phases and real atomic files/tar under a private temp root.

Root admission, systemd, the existing host guard and native health are mocked.
The separate guarded nspawn profile establishes those real kernel boundaries.
"""
from contextlib import redirect_stdout
from importlib.machinery import SourceFileLoader
import importlib.util
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
loader = SourceFileLoader("native_cohort", str(ROOT / "scripts/deploy-native-cohort"))
spec = importlib.util.spec_from_loader(loader.name, loader)
native = importlib.util.module_from_spec(spec)
loader.exec_module(native)
REAL_COMMAND, REAL_ATOMIC = native.command, native.atomic
REAL_HEALTH = native.Native.health


class OperatorWorkflow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="native-rollout-synthetic-")
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.stage = self.root / "stage"
        self.stage.mkdir(mode=0o700)
        (self.stage / "native").mkdir(mode=0o700)
        self.state, self.work = self.root / "state", self.root / "work"
        self.state.mkdir(mode=0o700)
        self.work.mkdir(mode=0o700)
        (self.state / "lock").touch(mode=0o600)
        (self.state / "submissions").mkdir()
        self.protected = self.state / "submissions/protected.bin"
        self.protected.write_bytes(b"protected historical bytes")
        self.buffer = self.work / "saved.c"
        self.buffer.write_bytes(b"int main(void) { return 0; }\n")
        state = {"attempts": {"history": {"state": "COMPLETED", "protected": True, "access_state": "RELEASED", "settings": {"duration": 5400}, "start": 100, "deadline": 200, "original_deadline": 200}}, "capabilities": {}, "commands": {}, "pane_instances": {}}
        (self.state / "state.json").write_text(json.dumps(state))
        self.config_dir = self.root / "config"
        self.config_dir.mkdir()
        self.config = self.config_dir / "agent.json"
        self.cli_config = self.config_dir / "examctl.json"
        self.config.write_text(json.dumps({"state": "/var/lib/exam-agent", "work": "/srv/exam-workspace/work", "socket": "/run/no-such-synthetic-native-socket"}))
        self.cli_config.write_text("{}")
        self.key = self.config_dir / "synthetic-private-key"
        self.key.write_bytes(b"private synthetic fixture, never a production key")
        self.targets, before, after = {}, {}, {}
        for name in native.TARGETS:
            path = self.root / name
            path.write_bytes(b"old ELF fixture " + name.encode())
            path.chmod(0o755)
            self.targets[name] = str(path)
            before[name] = native.digest(path)
            source = self.stage / "native" / name
            source.write_bytes(b"new ELF fixture " + name.encode())
            source.chmod(0o700)
            after[name] = native.digest(source)
        self.pid = 20
        self.units = {name: {"ActiveState": "active", "MainPID": str(i + 10)} for i, name in enumerate(native.ROLES)}
        self.units["exam-reconcile.timer"] = {"ActiveState": "active", "MainPID": "0"}
        self.units["exam-reconcile.service"] = {"ActiveState": "inactive", "MainPID": "0"}
        self.units["exam-ssh-relay.service"] = {"ActiveState": "active", "MainPID": "4"}
        self.calls = []
        helper = self.stage / "native-guard.py"
        helper.write_text("from pathlib import Path\nimport json,sys,datetime\nr=json.loads((Path(sys.argv[1])/'release.json').read_text())\nprint(json.dumps({'guard':'PASS','host':'csc-sys','phase':'after-cli','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'native_roles':[{'unit':k,'pid':v} for k,v in r['service_pids'].items() if k!='exam-ssh-relay.service'],'history_sha256':r['native_history_sha256'],'config_sha256':r['native_config_sha256'],'cli_config_sha256':r['cli_config_sha256'],'installed_cli_sha256':r['cli_sha256'],'worker_cli_sha256':r['worker_cli_sha256'],'relay_pid':r['service_pids']['exam-ssh-relay.service'],'relay_sha256':r['relay_sha256']}))\n")
        helper.chmod(0o600)
        self.release = {"schema": 37, "revision": "a" * 40, "old_image_config_id": "sha256:" + "b" * 64, "image_config_id": "sha256:" + "c" * 64, "fast_ui": {"state": str(self.root / "web-state")}, "native_history_sha256": hashlib.sha256(native.canonical(state["attempts"])).hexdigest(), "native_config_sha256": native.digest(self.config), "cli_config_sha256": native.digest(self.cli_config), "relay_sha256": "0" * 64, "unit_sha256": "d" * 64,
                        "native_update": {"nonce": str(uuid.uuid4()), "guard_sha256": native.digest(helper), "before": {"binary_sha256": before, "worker_cli_sha256": before["examctl"], "service_pids": {k: int(v["MainPID"]) for k, v in self.units.items() if k in native.ROLES or k == "exam-ssh-relay.service"}}, "after": {"binary_sha256": after, "worker_cli_sha256": after["examctl"]}}}
        self.write_release()
        self.web = {"nonce": self.release["native_update"]["nonce"], "phase": "WAITING_NATIVE", "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "web_state": self.release["fast_ui"]["state"], "web_status_sha256": "e" * 64, "web_image_config_id": self.release["old_image_config_id"], "image_config_id": self.release["image_config_id"], "revision": self.release["revision"], "native_binary_sha256": after, "web_stopped": True, "web_fenced": True}
        self.write_web()
        self.patchers = [patch.object(native, "require_root"), patch.object(native, "OWNER_UID", os.geteuid()), patch.object(native, "TARGETS", self.targets), patch.object(native, "CONFIG", self.config), patch.object(native, "CLI_CONFIG", self.cli_config), patch.object(native, "GUARD_SHA256", native.digest(helper)), patch.object(native, "roots", lambda config: (self.state, self.work)), patch.object(native, "command", self.command), patch.object(native.Native, "health", lambda operation: self.health(operation)), patch.object(native.Native, "backup_paths", lambda operation: [self.state, self.work, self.config_dir, *map(Path, self.targets.values())])]
        for patcher in self.patchers:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp.cleanup()

    def write_release(self):
        path = self.stage / "release.json"
        path.write_text(json.dumps(self.release))
        path.chmod(0o600)

    def write_web(self):
        path = self.stage / "web-stop.json"
        path.write_text(json.dumps(self.web))
        path.chmod(0o600)

    def command(self, args, timeout=25):
        self.calls.append(list(map(str, args)))
        if args[0] == "/usr/sbin/nginx":
            if getattr(self, "nginx_refused", False):
                raise AssertionError("synthetic proxy validation refused")
            return ""
        if args[:2] == ["/usr/bin/systemctl", "reload"]:
            self.assertEqual(args[2:], ["nginx.service"])
            return ""
        if args[0] != "/usr/bin/systemctl":
            return REAL_COMMAND(args, timeout)
        if args[1] == "show":
            return "\n".join(k + "=" + v for k, v in self.units[args[2]].items())
        for name in args[2:]:
            if args[1] == "stop":
                self.units[name] = {"ActiveState": "inactive", "MainPID": "0"}
            elif self.units[name]["ActiveState"] != "active":
                self.pid += 1
                self.units[name] = {"ActiveState": "active", "MainPID": str(self.pid if name in native.ROLES or name == "exam-ssh-relay.service" else 0)}
        return ""

    def health(self, operation):
        operation.preserved()
        operation.binaries("after")
        self.assertTrue(all(self.units[name]["ActiveState"] == "active" for name in native.ROLES))

    def cli(self, phase):
        output = io.StringIO()
        with patch.object(sys, "argv", ["deploy-native-cohort", "--stage", str(self.stage), phase]), redirect_stdout(output):
            native.main()
        return json.loads(output.getvalue())

    def stopped_backup(self):
        self.cli("stop")
        return self.cli("backup")

    def relay_setup(self):
        relay = self.root / "exam-ssh-relay"
        relay.write_bytes(b"old relay fixture"); relay.chmod(0o755)
        candidate = self.stage / "native/exam-ssh-relay"
        candidate.write_bytes(b"new relay fixture"); candidate.chmod(0o700)
        preserve = [self.config_dir / name for name in ("relay-config.json", "relay-trust.pub", "relay.service")]
        for path in preserve: path.write_bytes(b"existing trust and local configuration")
        nginx = self.config_dir / "relay-nginx.conf"; nginx.write_bytes(b"old proxy"); nginx.chmod(0o644)
        source = self.stage / "relay-nginx.conf"; source.write_bytes(b"new sixty-second proxy"); source.chmod(0o600)
        self.release["fast_ui"]["reviewed_scope"] = "monitoring-timeouts-v2"
        self.release["relay_sha256"] = native.digest(relay)
        update = self.release["native_update"]
        update["before"]["binary_sha256"]["exam-ssh-relay"] = native.digest(relay)
        update["after"]["binary_sha256"]["exam-ssh-relay"] = native.digest(candidate)
        update["relay"] = {"preserve_sha256": {str(p): native.digest(p) for p in preserve},
            "nginx_before_sha256": native.digest(nginx), "nginx_after_sha256": native.digest(source)}
        self.web["native_binary_sha256"] = update["after"]["binary_sha256"]
        for patcher in [patch.object(native, "RELAY", relay), patch.object(native, "RELAY_NGINX", nginx),
                patch.object(native, "RELAY_PRESERVE", preserve),
                patch.object(native.Native, "backup_paths", lambda operation: [self.state, self.work, self.config_dir, relay, *map(Path, self.targets.values())])]:
            patcher.start(); self.patchers.append(patcher)
        self.write_release(); self.write_web()
        return relay, nginx, preserve

    def test_five_binary_upgrade_keeps_relay_trust_and_retries_proxy_refusal_while_stopped(self):
        relay, nginx, preserve = self.relay_setup()
        original = {p: p.read_bytes() for p in preserve}
        backup = self.stopped_backup()
        with tarfile.open(backup["backup"]) as archive:
            self.assertEqual(archive.extractfile(str(relay).lstrip("/")).read(), b"old relay fixture")
        self.nginx_refused = True
        with self.assertRaisesRegex(AssertionError, "proxy validation"):
            self.cli("install")
        self.assertEqual(self.cli("status")["phase"], "INSTALLING")
        self.assertEqual(self.units["exam-ssh-relay.service"]["ActiveState"], "inactive")
        self.nginx_refused = False
        self.cli("install"); self.cli("start")
        proof = self.cli("verify")
        after = self.cli("guard-after")
        self.assertEqual(after["relay_sha256"], native.digest(relay))
        self.assertEqual(after["relay_pid"], proof["service_pids"]["exam-ssh-relay.service"])
        self.assertEqual(native.digest(relay), self.release["native_update"]["after"]["binary_sha256"]["exam-ssh-relay"])
        self.assertNotEqual(proof["service_pids"]["exam-ssh-relay.service"], 4)
        self.assertEqual(nginx.read_bytes(), b"new sixty-second proxy")
        self.assertEqual({p: p.read_bytes() for p in preserve}, original)
        self.assertEqual(self.buffer.read_bytes(), b"int main(void) { return 0; }\n")

    def test_relay_config_drift_and_missing_fifth_binary_refuse_before_stopping(self):
        relay, nginx, preserve = self.relay_setup()
        prior = preserve[0].read_bytes(); preserve[0].write_bytes(b"changed configuration")
        with self.assertRaisesRegex(AssertionError, "Relay trust/configuration changed"):
            self.cli("stop")
        self.assertFalse(self.calls)
        preserve[0].write_bytes(prior)
        (self.stage / "native/exam-ssh-relay").unlink()
        with self.assertRaises(FileNotFoundError): self.cli("stop")
        self.assertFalse(self.calls)

    def test_full_cli_forward_upgrade_retains_data_and_produces_bound_guard(self):
        old = {name: Path(path).stat().st_ino for name, path in self.targets.items()}
        self.assertEqual(self.cli("guard-before")["phase"], "before-native")
        backup = self.stopped_backup()
        with tarfile.open(backup["backup"]) as archive:
            self.assertEqual(archive.extractfile(str(self.key).lstrip("/")).read(), self.key.read_bytes())
        for phase in ("install", "start", "verify"):
            self.cli(phase)
        proof = self.cli("guard-after")
        self.assertTrue(proof["policy_supported"])
        self.assertEqual(proof["nonce"], self.release["native_update"]["nonce"])
        self.assertEqual(proof["transition_receipt_sha256"], native.digest(self.stage / "native-transition.json"))
        self.assertTrue(all(Path(path).stat().st_ino != old[name] for name, path in self.targets.items()))
        self.assertEqual(self.buffer.read_bytes(), b"int main(void) { return 0; }\n")
        self.assertEqual(self.units["exam-ssh-relay.service"]["MainPID"], "4")
        self.assertFalse(any("exam-ssh-relay.service" in call for call in self.calls if call[1] in ("stop", "start")))

    def test_stale_wrong_candidate_or_unfenced_web_proof_refuses_before_stop(self):
        for key, value in (("at", "2020-01-01T00:00:00+00:00"), ("web_fenced", False), ("revision", "f" * 40), ("image_config_id", "sha256:" + "f" * 64), ("nonce", str(uuid.uuid4()))):
            old = self.web[key]
            self.web[key] = value
            self.write_web()
            with self.assertRaises(AssertionError):
                self.cli("stop")
            self.web[key] = old
        self.assertFalse(any(call[1] == "stop" for call in self.calls))

    def test_live_or_changed_attempt_is_not_cancelled_to_obtain_drain(self):
        path = self.state / "state.json"
        value = json.loads(path.read_text())
        value["attempts"]["history"]["state"] = "PREPARING"
        path.write_text(json.dumps(value))
        with self.assertRaises(AssertionError):
            self.cli("stop")
        self.assertFalse(self.calls)

    def test_corrupt_source_and_changed_release_refuse_before_mutation(self):
        (self.stage / "native/exam-agent").write_bytes(b"corrupt")
        with self.assertRaises(AssertionError):
            self.cli("stop")
        self.assertFalse(self.calls)

    def test_partial_atomic_install_retries_same_candidate_without_starting_old_writer(self):
        self.stopped_backup()
        count = 0
        def crash(path, data, mode=0o600):
            nonlocal count
            if str(path) in self.targets.values():
                count += 1
                if count == 3:
                    raise RuntimeError("synthetic process failure between executables")
            return REAL_ATOMIC(path, data, mode)
        with patch.object(native, "atomic", crash), self.assertRaises(RuntimeError):
            self.cli("install")
        self.assertEqual(self.cli("status")["phase"], "INSTALLING")
        with self.assertRaises(AssertionError):
            self.cli("start")
        self.cli("install")
        self.cli("start")
        self.assertEqual(self.cli("verify")["phase"], "NATIVE_MATCHED_VERIFIED")

    def test_unknown_partial_file_is_not_overwritten_and_backups_are_checked(self):
        self.stopped_backup()
        Path(self.targets["exam-info"]).write_bytes(b"unreviewed replacement")
        with self.assertRaises(AssertionError):
            self.cli("install")
        self.assertEqual(Path(self.targets["exam-info"]).read_bytes(), b"unreviewed replacement")

    def test_damaged_backup_blocks_install(self):
        receipt = self.stopped_backup()
        Path(receipt["backup"]).write_bytes(b"not verified recovery coverage")
        with self.assertRaises(AssertionError):
            self.cli("install")

    def test_incomplete_backup_preserved_and_fresh_backup_can_retry(self):
        self.cli("stop")
        incomplete = self.stage / "backup"
        incomplete.mkdir(mode=0o700)
        (incomplete / "partial.tar").write_bytes(b"incomplete")
        result = self.cli("backup")
        self.assertEqual(result["phase"], "BACKED_UP")
        self.assertEqual((incomplete / "partial.tar").read_bytes(), b"incomplete")

    def test_failed_start_can_resume_new_cohort_but_never_rolls_back(self):
        self.stopped_backup()
        self.cli("install")
        with patch.object(native.Native, "health", side_effect=AssertionError("synthetic installed service refusal")), self.assertRaises(AssertionError):
            self.cli("start")
        self.assertEqual(self.cli("status")["phase"], "STARTING")
        self.cli("start")
        self.cli("verify")
        for name, path in self.targets.items():
            self.assertEqual(native.digest(path), self.release["native_update"]["after"]["binary_sha256"][name])

    def test_changed_protected_bytes_or_role_restart_blocks_transition(self):
        self.stopped_backup()
        self.cli("install")
        self.cli("start")
        self.protected.write_bytes(b"unexpected mutation")
        with self.assertRaises(AssertionError):
            self.cli("verify")
        self.assertFalse((self.stage / "native-transition.json").exists())

    def test_candidate_cannot_be_rebound_after_durable_stop(self):
        self.cli("stop")
        self.release["revision"] = "f" * 40
        self.write_release()
        with self.assertRaises(AssertionError):
            self.cli("backup")

    def test_only_bounded_known_startup_readiness_is_retried(self):
        self.stopped_backup()
        self.cli("install")
        seen = []
        def pending(operation):
            seen.append(1)
            if len(seen) == 1:
                raise native.StartupPending()
            self.health(operation)
        with patch.object(native.Native, "health", pending), patch.object(native.time, "sleep") as sleeping:
            self.cli("start")
        self.assertEqual(len(seen), 2)
        sleeping.assert_called_once_with(0.1)

    def test_role_replacement_or_relay_change_blocks_transition(self):
        self.stopped_backup()
        self.cli("install")
        self.cli("start")
        self.units["exam-source-setup.service"]["MainPID"] = "9001"
        with self.assertRaises(AssertionError):
            self.cli("verify")
        self.assertFalse((self.stage / "native-transition.json").exists())

    def test_after_guard_needs_verified_transition_and_old_writer_rollback_is_not_a_command(self):
        with self.assertRaises(AssertionError):
            self.cli("guard-after")
        with self.assertRaises(SystemExit):
            self.cli("rollback")

    def test_fresh_role_agreement_precedes_process_hash_during_simple_startup(self):
        self.stopped_backup()
        self.cli("install")
        operation = native.Native(self.stage)
        operation.record["phase"] = "STARTING"
        reply = {"execution_policy_support": {"supported": False}, "native_roles": {"complete": False}}
        def unavailable(args, timeout=25):
            self.assertEqual(args, [self.targets["examctl"], "health"])
            return json.dumps(reply)
        with patch.object(native, "command", unavailable), self.assertRaises(native.StartupPending):
            REAL_HEALTH(operation)
        # An unavailable endpoint is a bounded startup wait only, never a
        # positive ready result or an indefinitely reusable verification.
        with patch.object(native, "command", side_effect=AssertionError("not listening")), self.assertRaises(native.StartupPending):
            REAL_HEALTH(operation)
        operation.record["phase"] = "RUNNING"
        with patch.object(native, "command", side_effect=AssertionError("not listening")), self.assertRaises(AssertionError):
            REAL_HEALTH(operation)

    def test_duplicate_operator_invocation_refuses_while_readonly_status_remains_available(self):
        descriptor = os.open(self.stage / "native-operation.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, "still running"):
                self.cli("stop")
            self.assertEqual(self.cli("status")["phase"], "STAGED")
            self.assertFalse(self.calls)
        finally:
            os.close(descriptor)
        self.assertEqual(self.cli("stop")["phase"], "STOPPED")


if __name__ == "__main__":
    unittest.main()
