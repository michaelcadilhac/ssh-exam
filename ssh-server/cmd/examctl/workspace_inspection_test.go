package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The compiled CLI, ordinary worker, protected bundle and Linux /proc observations
// are real. ONLY the system-manager resource interface is replaced in the private
// mount namespace; this is not installed cgroup/PAM qualification.
func TestWorkspaceDryRunCompiledCLIInPrivateNamespaces(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for compiled root-mapped CLI/private kernel observations")
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	write := func(path string, b []byte, mode os.FileMode) {
		t.Helper()
		if err := os.WriteFile(path, b, mode); err != nil {
			t.Fatal(err)
		}
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	pubDER, _ := x509.MarshalPKIXPublicKey(pub)
	keyDER, _ := x509.MarshalPKCS8PrivateKey(key)
	pubPath, keyPath := filepath.Join(dir, "gateway.pub"), filepath.Join(dir, "agent.key")
	write(pubPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), 0600)
	write(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600)
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackURL: "https://unused.example.edu", CallbackKey: keyPath, GatewayPublicKey: pubPath, Accounts: map[string]core.Account{"synthetic": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	e, err := core.New(c)
	if err != nil {
		t.Fatal(err)
	}
	const id = "12345678-1234-4234-8234-123456789abc"
	work := filepath.Join(c.Work, id, "work")
	if err := os.MkdirAll(work, 0700); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(work, "answer.txt"), []byte("SYNTHETIC SAVED ANSWER\n"), 0600)
	for i := range 512 {
		write(filepath.Join(work, fmt.Sprintf("synthetic-%04d.txt", i)), []byte("bounded synthetic file\n"), 0600)
	}
	now := core.Millis()
	a := &core.Attempt{ID: id, Exam: "midterm", Username: "synthetic", UID: 29999, State: "COMPLETED", Settings: core.Settings{Duration: 3600, Template: "v1"}, Start: now - 1000, Ended: now, Deadline: now + 3599000, OriginalDeadline: now + 3599000, Protected: true, AccessState: "HELD", WorkPath: "/work"}
	a.Checksum, err = core.Collect(work, filepath.Join(c.State, "submissions", id), a)
	if err != nil {
		t.Fatal(err)
	}
	state := core.State{Attempts: map[string]*core.Attempt{id: a}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	stateBytes, _ := json.Marshal(state)
	write(filepath.Join(c.State, "state.json"), stateBytes, 0600)
	config := filepath.Join(dir, "config.json")
	configBytes, _ := json.Marshal(c)
	write(config, configBytes, 0600)
	// Ensure all initialized authority/hold prerequisites exist before the worker;
	// a metadata inspection must not invent a protected archive.
	if _, err := e.WorkspaceRetention(id); err != nil {
		t.Fatal(err)
	}
	// WorkspaceRetention's existing metadata entry uses the normal state writer;
	// compare the worker against the completed setup, not pre-normalization JSON.
	stateBytes, err = os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	manager := filepath.Join(dir, "private-manager.py")
	write(manager, []byte(`#!/usr/bin/python3
import array,ctypes,json,mmap,os,select,socket,subprocess,sys,tempfile
args=sys.argv[1:]
if os.path.basename(sys.argv[0])=='systemctl':
    assert args==['show','exam-collection.slice','--property=LoadState','--property=MemoryMax','--property=MemorySwapMax','--property=TasksMax'],args
    print('LoadState='+('not-found' if os.getenv('EXAM_WORKSPACE_TEST_REFERENCE')=='pool-missing' else 'loaded')+'\nMemoryMax=536870912\nMemorySwapMax=0\nTasksMax=96')
else:
    assert '--property=Slice=exam-collection.slice' in args and '--property=MemoryMax=256M' in args and '--property=RuntimeMaxSec=120' in args,args
    command=args[args.index('--')+1:]
    assert len(command)==2 and command[1]=='--workspace-inspection-worker',command
    mode=os.getenv('EXAM_WORKSPACE_TEST_REFERENCE','none')
    if mode in ['bad-reply','wrong-scope','worker-exit']:
        request=json.load(sys.stdin.buffer)
        assert request['purpose']=='workspace-inspection/v1' and len(request['nonce'])==64
        if mode=='worker-exit': raise SystemExit(17)
        if mode=='bad-reply': print('x'*8193)
        else: print(json.dumps({'purpose':request['purpose'],'nonce':request['nonce'],'id':'00000000-0000-4000-8000-000000000000','error':'wrong-scope'}))
        raise SystemExit(0)
    work=os.environ['EXAM_WORKSPACE_TEST_WORK']
    held=None
    child=None
    namespace_fd=None
    namespace_path=None
    deleted_scratch=None
    if mode in ['unrelated-deleted-mount','workspace-device-deleted-mount']:
        deleted_scratch=tempfile.mkdtemp(prefix='deleted-mount-',dir=os.path.dirname(os.path.dirname(work)))
        backing=deleted_scratch+'/backing';os.mkdir(backing,0o700)
        libc=ctypes.CDLL(None,use_errno=True)
        if mode=='unrelated-deleted-mount':
            assert libc.mount(b'tmpfs',backing.encode(),b'tmpfs',6,None)==0,ctypes.get_errno()
        source=backing+'/synthetic-source';open(source,'xb').close()
        deleted_alias=deleted_scratch+'/alias';open(deleted_alias,'xb').close()
        assert libc.mount(source.encode(),deleted_alias.encode(),None,4096,None)==0,ctypes.get_errno()
        assert (os.stat(deleted_alias).st_dev!=os.stat(work).st_dev)==(mode=='unrelated-deleted-mount')
        os.unlink(source)
        with open('/proc/self/mountinfo') as table:
            rows=[row.split(' ') for row in table.read().splitlines()]
        assert any(row[4]==deleted_alias and row[3].endswith('//deleted') for row in rows),'fixture never reached a deleted bind source'
    if mode=='descriptor': held=open(work+'/answer.txt','rb')
    if mode=='queued-descriptor':
        queued_reader,queued_writer=socket.socketpair()
        fd=os.open(work+'/answer.txt',os.O_RDONLY)
        queued_writer.sendmsg([b'x'],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[fd]))])
        os.close(fd)
    if mode=='cwd': os.chdir(work)
    if mode=='mapping':
        f=open(work+'/answer.txt','rb'); held=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ); f.close()
    if mode in ['unrelated-watch','workspace-watch']:
        libc=ctypes.CDLL(None,use_errno=True)
        fd=libc.inotify_init1(os.O_CLOEXEC)
        assert fd>=0
        target=work if mode=='workspace-watch' else os.path.dirname(os.path.dirname(work))
        assert libc.inotify_add_watch(fd,target.encode(),2)>=0
    if mode in ['foreign-directory-mount','foreign-file-mount','foreign-hidden-mount','detached-namespace-fd','mounted-namespace-handle']:
        alias=os.path.dirname(os.path.dirname(os.path.dirname(work)))+'/foreign-alias'
        source=work if mode!='foreign-file-mount' else work+'/answer.txt'
        if mode!='foreign-file-mount': os.mkdir(alias,0o700)
        else: open(alias,'xb').close()
        ready_r,ready_w=os.pipe(); done_r,done_w=os.pipe()
        ns_parent,ns_child=socket.socketpair()
        ns_parent.settimeout(3);ns_child.settimeout(3)
        child=os.fork()
        if child==0:
            os.close(ready_r);os.close(done_w)
            libc=ctypes.CDLL(None,use_errno=True)
            assert libc.unshare(0x00020000)==0,ctypes.get_errno()
            assert libc.mount(source.encode(),alias.encode(),None,4096,None)==0,ctypes.get_errno()
            if mode=='foreign-hidden-mount':
                jail=alias+'-jail';os.mkdir(jail,0o700)
                assert libc.mount(jail.encode(),jail.encode(),None,4096,None)==0,ctypes.get_errno()
                os.chroot(jail);os.chdir('/')
            if mode in ['detached-namespace-fd','mounted-namespace-handle']:
                ns=os.open('/proc/self/ns/mnt',os.O_RDONLY)
                ns_child.sendmsg([b'R'],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[ns]))])
                os._exit(0)
            os.write(ready_w,b'R');os.close(ready_w)
            os.read(done_r,1)
            os._exit(0)
        os.close(ready_w);os.close(done_r)
        if mode in ['detached-namespace-fd','mounted-namespace-handle']:
            ns_child.close()
            data,anc,flags,addr=ns_parent.recvmsg(1,socket.CMSG_SPACE(array.array('i').itemsize))
            assert data==b'R' and len(anc)==1
            fds=array.array('i');fds.frombytes(anc[0][2]);assert len(fds)==1
            namespace_fd=fds[0];os.close(done_w)
            assert os.waitpid(child,0)[1]==0;child=None
            if mode=='mounted-namespace-handle':
                namespace_path=alias+'-namespace';open(namespace_path,'xb').close()
                libc=ctypes.CDLL(None,use_errno=True)
                assert libc.mount(('/proc/self/fd/'+str(namespace_fd)).encode(),namespace_path.encode(),None,4096,None)==0,ctypes.get_errno()
                os.close(namespace_fd);namespace_fd=None
        else:
            assert select.select([ready_r],[],[],3)[0]
            assert os.read(ready_r,1)==b'R'
        os.close(ready_r);ns_parent.close();ns_child.close()
    try: result=subprocess.run(command,stdin=sys.stdin.buffer,stdout=sys.stdout.buffer,stderr=sys.stderr.buffer).returncode
    finally:
        if child is not None:
            os.close(done_w)
            assert os.waitpid(child,0)[1]==0
            if mode!='foreign-file-mount': os.rmdir(alias)
            else: os.unlink(alias)
            if mode=='foreign-hidden-mount': os.rmdir(alias+'-jail')
        if mode in ['detached-namespace-fd','mounted-namespace-handle']:
            if namespace_fd is not None: os.close(namespace_fd)
            if namespace_path is not None:
                assert ctypes.CDLL(None).umount2(namespace_path.encode(),0)==0
                os.unlink(namespace_path)
            os.rmdir(alias)
        if deleted_scratch is not None:
            assert ctypes.CDLL(None).umount2(deleted_alias.encode(),0)==0
            os.unlink(deleted_alias)
            if mode=='unrelated-deleted-mount':assert ctypes.CDLL(None).umount2(backing.encode(),0)==0
            os.rmdir(backing);os.rmdir(deleted_scratch)
    raise SystemExit(result)
`), 0700)
	rawInvoke := func(mode string, args ...string) ([]byte, string, error) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		argv := []string{"--user", "--map-root-user", "--mount", "--pid", "--kill-child", "--mount-proc", os.Args[0], "-test.run=^TestTemplateCLIContainer$", "--", manager, binary, "--config", config, "workspaces"}
		argv = append(argv, args...)
		cmd := exec.CommandContext(ctx, "/usr/bin/unshare", argv...)
		cmd.Env = append(os.Environ(), "EXAM_TEMPLATE_CLI_CONTAINER=1", "EXAM_WORKSPACE_TEST_REFERENCE="+mode, "EXAM_WORKSPACE_TEST_WORK="+work, "GOMAXPROCS=2", "GORACE=atexit_sleep_ms=0")
		var out, stderr bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &stderr
		cmd.WaitDelay = 3 * time.Second
		err := cmd.Run()
		return out.Bytes(), stderr.String(), err
	}
	invoke := func(mode string) core.WorkspaceCleanupPreview {
		t.Helper()
		out, stderr, err := rawInvoke(mode, "dry-run", id)
		var result core.WorkspaceCleanupPreview
		if err != nil || json.Unmarshal(out, &result) != nil {
			t.Fatal(mode, err, string(out), stderr)
		}
		if result.Attempt != id || !result.ArchiveVerified || result.Review == "" {
			t.Fatal("did not reach fresh verified kernel inspection", mode, result)
		}
		return result
	}
	for _, mode := range []string{"none", "unrelated-watch", "unrelated-deleted-mount", "workspace-device-deleted-mount", "descriptor", "cwd", "mapping", "workspace-watch", "foreign-directory-mount", "foreign-file-mount", "foreign-hidden-mount", "detached-namespace-fd", "mounted-namespace-handle"} {
		t.Run(mode, func(t *testing.T) {
			v := invoke(mode)
			if mode == "none" || mode == "unrelated-watch" || mode == "unrelated-deleted-mount" {
				if !v.UsageObserved || !v.SnapshotClear || v.Eligible || len(v.Uses) != 0 {
					t.Fatal("quiet/unrelated observation falsely refused", v)
				}
			} else if mode == "foreign-hidden-mount" {
				if v.Eligible || v.SnapshotClear || v.UsageObserved || !strings.Contains(strings.Join(v.Blockers, " "), "root view") {
					t.Fatal("hidden foreign mount incorrectly looked unused", v)
				}
			} else if mode == "detached-namespace-fd" || mode == "mounted-namespace-handle" || mode == "workspace-device-deleted-mount" {
				cause := "namespace handle"
				if mode != "detached-namespace-fd" {
					cause = "mount topology unavailable"
				} // nsfs root is deliberately not interpreted as a pathname.
				if v.Eligible || v.SnapshotClear || v.UsageObserved || !strings.Contains(strings.Join(v.Blockers, " "), cause) {
					t.Fatal("retained foreign namespace incorrectly looked unused", mode, v)
				}
			} else {
				kind := map[string]string{"descriptor": "descriptor", "cwd": "cwd", "mapping": "mapping", "workspace-watch": "watch", "foreign-directory-mount": "mount-source", "foreign-file-mount": "mount-source"}[mode]
				found := false
				for _, use := range v.Uses {
					if use.Kind == kind {
						found = true
					}
				}
				if v.Eligible || v.SnapshotClear || !v.UsageObserved || !found {
					t.Fatal("foreign live reference missed", mode, v)
				}
			}
		})
	}
	for _, mode := range []string{"pool-missing", "bad-reply", "wrong-scope", "worker-exit"} {
		t.Run(mode, func(t *testing.T) {
			out, stderr, err := rawInvoke(mode, "dry-run", id)
			if err == nil || len(out) != 0 || !strings.Contains(stderr, "No cleanup or queued operation") {
				t.Fatal("worker failure published authority or misleading retry", mode, err, string(out), stderr)
			}
		})
	}
	readBlocked := func(cause string) core.WorkspaceCleanupPreview {
		t.Helper()
		out, stderr, err := rawInvoke("none", "dry-run", id)
		var v core.WorkspaceCleanupPreview
		if err != nil || json.Unmarshal(out, &v) != nil || v.Review == "" || v.Attempt != id || v.Eligible || v.SnapshotClear || v.UsageObserved || !strings.Contains(strings.Join(v.Blockers, " "), cause) {
			t.Fatal("did not reach intended refusal", cause, err, string(out), stderr)
		}
		return v
	}
	for _, action := range []struct{ name, revision string }{{"hold", "0"}, {"release-hold", "1"}} {
		out, stderr, err := rawInvoke("none", action.name, id, "--revision", action.revision, "--reason", "Reviewed synthetic hold workflow before archive inspection")
		if err != nil {
			t.Fatal("hold CLI", err, string(out), stderr)
		}
		if action.name == "hold" {
			v := readBlocked("Administrator workspace hold is active")
			if !v.Hold.Held || v.ArchiveVerified {
				t.Fatal("hold bypassed before heavy observation", v)
			}
		}
	}
	if !invoke("none").SnapshotClear {
		t.Fatal("released retention hold did not become inspectable")
	}
	checksumPath := filepath.Join(c.State, "submissions", id, "archive.sha256")
	checksum, err := os.ReadFile(checksumPath)
	if err != nil {
		t.Fatal(err)
	}
	write(checksumPath, []byte(strings.Repeat("0", 64)), 0600)
	v := readBlocked("Fresh protected archive verification failed")
	if v.ArchiveVerified {
		t.Fatal("corrupt checksum claimed fresh archive verification")
	}
	write(checksumPath, checksum, 0600)
	if !invoke("none").SnapshotClear {
		t.Fatal("verified archive repair was not retryable")
	}
	after, err := os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil || !bytes.Equal(stateBytes, after) {
		t.Fatal("inspection changed authoritative history", err)
	}
	answer, err := os.ReadFile(filepath.Join(work, "answer.txt"))
	if err != nil || !strings.Contains(string(answer), "SYNTHETIC SAVED ANSWER") {
		t.Fatal("inspection changed work", err)
	}
	preview := invoke("none")
	request := core.ManagementID()
	args := []string{"cleanup", id, "--review", preview.Review, "--request", request, "--reason", "Reviewed synthetic protected workspace cleanup with no grace period"}
	for _, mode := range []string{"workspace-device-deleted-mount", "descriptor", "queued-descriptor", "cwd", "mapping", "workspace-watch", "foreign-directory-mount", "foreign-file-mount", "foreign-hidden-mount", "detached-namespace-fd"} {
		out, stderr, err := rawInvoke(mode, args...)
		if err == nil || len(out) != 0 {
			t.Fatal("cleanup ignored real kernel reference", mode, err, string(out), stderr)
		}
		if mode == "queued-descriptor" && !strings.Contains(stderr, "exclusive file-reference barrier refused") {
			t.Fatal("queued-only descriptor did not reach lease refusal", stderr)
		}
		if _, err := os.Lstat(filepath.Join(c.State, "workspace-cleanups", id+".json")); !os.IsNotExist(err) {
			t.Fatal("refused cleanup accepted a durable job", mode, err)
		}
		if data, err := os.ReadFile(filepath.Join(work, "answer.txt")); err != nil || !bytes.Equal(data, answer) {
			t.Fatal("refused cleanup changed saved work", mode, err)
		}
	}
	write(filepath.Join(work, "answer.txt"), []byte("NEW UNARCHIVED BYTES\n"), 0600)
	out, stderr, err := rawInvoke("none", args...)
	if err == nil || len(out) != 0 || !strings.Contains(stderr, "absent from its protected archive") {
		t.Fatal("cleanup discarded unarchived changes", err, string(out), stderr)
	}
	write(filepath.Join(work, "answer.txt"), answer, 0600)
	audit := filepath.Join(c.State, "audit.ndjson")
	if err := os.Rename(audit, audit+".preserved"); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(audit, 0600); err != nil {
		t.Fatal(err)
	}
	out, stderr, err = rawInvoke("none", args...)
	if err == nil || len(out) != 0 {
		t.Fatal("cleanup ignored unsafe audit sink", err, string(out), stderr)
	}
	if _, err := os.Lstat(filepath.Join(c.State, "workspace-cleanups", id+".json")); !os.IsNotExist(err) {
		t.Fatal("audit failure accepted cleanup", err)
	}
	if err := os.Remove(audit); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(audit+".preserved", audit); err != nil {
		t.Fatal(err)
	}
	opaque := filepath.Join(work, "synthetic-fifo")
	if err := syscall.Mkfifo(opaque, 0600); err != nil {
		t.Fatal(err)
	}
	blockedPreview := invoke("none")
	opaqueArgs := append([]string{}, args...)
	opaqueArgs[3] = blockedPreview.Review
	out, stderr, err = rawInvoke("none", opaqueArgs...)
	if err == nil || len(out) != 0 || !strings.Contains(stderr, "unsupported workspace object") {
		t.Fatal("opaque object did not reach intended refusal", err, string(out), stderr)
	}
	if err := os.Remove(opaque); err != nil {
		t.Fatal(err)
	}
	if out, stderr, err := rawInvoke("none", "cleanup", id, "--review", strings.Repeat("0", 64), "--request", core.ManagementID(), "--reason", "Synthetic stale review refusal"); err == nil || len(out) != 0 || !strings.Contains(stderr, "stale or blocked") {
		t.Fatal("stale cleanup review accepted", err, string(out), stderr)
	}
	out, stderr, err = rawInvoke("unrelated-deleted-mount", args...)
	var cleaned map[string]any
	if err != nil || json.Unmarshal(out, &cleaned) != nil || cleaned["phase"] != "COMPLETED" || cleaned["attempt"] != id || cleaned["request"] != request {
		t.Fatal("actual reviewed cleanup workflow did not complete", err, string(out), stderr)
	}
	if _, err := os.Lstat(filepath.Join(c.Work, id)); !os.IsNotExist(err) {
		t.Fatal("cleanup did not remove the exact reviewed UUID folder", err)
	}
	unchanged, err := os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil || !bytes.Equal(stateBytes, unchanged) {
		t.Fatal("cleanup changed authoritative attempt/hold/clock history", err)
	}
	protected, err := os.ReadFile(checksumPath)
	if err != nil || !bytes.Equal(protected, checksum) {
		t.Fatal("cleanup changed protected source", err)
	}
	for _, action := range []string{"cleanup-status", "cleanup"} {
		command := []string{action, id, "--request", request}
		if action == "cleanup" {
			command = args
		}
		reply, stderr, err := rawInvoke("none", command...)
		var status map[string]any
		if err != nil || json.Unmarshal(reply, &status) != nil || status["phase"] != "COMPLETED" || status["request"] != request {
			t.Fatal("inspection/exact retry lost durable completion", action, err, string(reply), stderr)
		}
	}
	show, stderr, err := rawInvoke("none", "show", id)
	var observed core.WorkspaceRetentionStatus
	if err != nil || json.Unmarshal(show, &observed) != nil || observed.Cleanup == nil || observed.Cleanup.Request != request || !observed.Cleanup.Cleaned || observed.Candidate || observed.AccessState != "HELD" {
		t.Fatal("metadata entry lost cleanup/account history", err, string(show), stderr)
	}
}
