#!/usr/bin/env python3
"""Prepare a PRIVATE test-browser client; never changes/builds production assets.

Usage: python3 tests/acceptance-split-ssh/prepare.py NEW_OUTPUT_DIRECTORY
Run the copied module's focused test first, then its complete client race suite.
Build with GOOS=js GOARCH=wasm go build -trimpath -o ../client.wasm .
Serve that WASM and the matching Go runtime ONLY in the owned acceptance browser.
"""
from pathlib import Path
import difflib
import hashlib
import json
import os
import shutil
import sys

os.umask(0o077)
root = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
output.mkdir(mode=0o700)  # Never reuse or erase a previous receipt.
module = output / 'module'
source = root / 'browser-ssh'
files = sorted([*source.rglob('*.go'), source / 'go.mod', source / 'go.sum'])
manifest = {}
for path in files:
    relative = path.relative_to(source)
    target = module / relative
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    manifest[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()

target = module / 'client/client.go'
original = target.read_text()
text = original
def replace(before, after):
    global text
    assert text.count(before) == 1, 'Source changed; review the exact adapter boundary'
    text = text.replace(before, after)

replace('type Host struct {\n', '''type Host struct {
	// Acceptance adapter ONLY; these fields do not exist in shipped clients.
	AcceptanceUsername string `json:"acceptance_username,omitempty"`
	AcceptancePrivateKey string `json:"acceptance_private_key,omitempty"`
''')
replace('func (c *Client) Connect(raw net.Conn, user string, jump, class Host, dialogue Dialogue) error {\n', '''func (c *Client) Connect(raw net.Conn, user string, jump, class Host, dialogue Dialogue) error {
	var bootstrap ssh.Signer
	if jump.AcceptanceUsername != "" || class.AcceptancePrivateKey != "" || class.AcceptanceUsername != "" || jump.AcceptancePrivateKey != "" {
		if jump.AcceptanceUsername == "" || class.AcceptancePrivateKey == "" || jump.AcceptancePrivateKey != "" || class.AcceptanceUsername != "" || user == jump.AcceptanceUsername {
			raw.Close()
			return errors.New("acceptance adapter requires distinct jump and ordinary class identities")
		}
		var err error
		bootstrap, err = ssh.ParsePrivateKey([]byte(class.AcceptancePrivateKey))
		class.AcceptancePrivateKey = ""
		if err != nil {
			raw.Close()
			return errors.New("acceptance bootstrap key rejected")
		}
	}
''')
replace('hop := func(conn net.Conn, h Host) (*ssh.Client, error) {', 'hop := func(conn net.Conn, h Host, login string, key ssh.Signer) (*ssh.Client, error) {')
replace('config := &ssh.ClientConfig{User: user, Timeout: 120 * time.Second}', 'config := &ssh.ClientConfig{User: login, Timeout: 120 * time.Second}')
replace('if PasswordPrompt(p, user, h.Host) {', 'if PasswordPrompt(p, login, h.Host) {')
replace('\t\tsc, channels, requests, err := ssh.NewClientConn', '''		if key != nil {
			// The institutional password is never offered to the synthetic account.
			config.Auth = []ssh.AuthMethod{ssh.PublicKeys(key)}
		}
		sc, channels, requests, err := ssh.NewClientConn''')
replace('j, err := hop(raw, jump)', '''jumpLogin := user
	if jump.AcceptanceUsername != "" { jumpLogin = jump.AcceptanceUsername }
	j, err := hop(raw, jump, jumpLogin, nil)''')
replace('k, err := hop(conn, class)', 'k, err := hop(conn, class, user, bootstrap)\n\tbootstrap = nil')
target.write_text(text)
shutil.copyfile(Path(__file__).with_name('client_test.go'), module / 'client/acceptance_split_test.go')
# Existing public client tests consume the shared native/browser wire fixture.
# Preserve its repository-relative location in the copied module's parent.
fixture = root / 'tests/fixtures/terminal-input-frame.json'
fixture_copy = output / 'tests/fixtures/terminal-input-frame.json'
fixture_copy.parent.mkdir(mode=0o700, parents=True)
shutil.copyfile(fixture, fixture_copy)
manifest['../tests/fixtures/terminal-input-frame.json'] = hashlib.sha256(fixture.read_bytes()).hexdigest()
(output / 'adapter.diff').write_text(''.join(difflib.unified_diff(original.splitlines(True), text.splitlines(True), fromfile='production/client.go', tofile='acceptance/client.go')))
(output / 'source-manifest.json').write_text(json.dumps({'test_only': True, 'source_sha256': manifest, 'adapter_sha256': hashlib.sha256(text.encode()).hexdigest(), 'acceptance_test_sha256': hashlib.sha256(Path(__file__).with_name('client_test.go').read_bytes()).hexdigest(), 'generator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'production_files_changed': False}, indent=2) + '\n')
print(json.dumps({'module': str(module), 'test_only': True, 'production_files_changed': False}))
