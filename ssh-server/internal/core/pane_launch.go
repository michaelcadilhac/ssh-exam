package core

import (
	"errors"
	"os"
	"os/exec"
)

// Actual Engine.local scope caller. Only a trusted bootstrap can start outside
// state; legacy host-service launches still use the serialized path. All IPC,
// manager startup and failure cleanup occur without owning shared state.
func (e *Engine) launchClosedLocalPane(p *paneLaunchAdmission, token, name, unit string, identify func(Account) (string, error), launch *exec.Cmd, bridge func(*paneBootstrapPeer) error) (started bool, err error) {
	if !e.paneLaunchMu.TryLock() {
		return false, errors.New("terminal startup is busy; retry opening this pane after checks settle; this is not a monitoring violation; inspect examctl panes list ATTEMPT")
	}
	defer e.paneLaunchMu.Unlock()
	defer func() {
		if p.supervisorControl != nil {
			verdict := byte(2)
			if err == nil {
				verdict = 1
			}
			// Reply ownership only, NOT an execution permit. Exec may already
			// have committed: a lost notice must not trigger destructive cleanup.
			_, _ = p.supervisorControl.Write([]byte{verdict})
			_ = p.supervisorControl.Close()
			p.supervisorControl = nil
		}
	}()
	control, child, err := paneBootstrapSocket()
	if err != nil {
		return false, errPaneBootstrap
	}
	defer control.Close()
	defer child.Close()
	executable, err := paneBootstrapExecutable()
	if err != nil {
		return false, err
	}
	defer executable.Close()
	proof, err := e.reserveClosedPane(p, token, name, unit, identify)
	if err != nil {
		return false, err
	}
	defer func() {
		// Close BEFORE killing/waiting/forgetting. Even a delayed manager may
		// start only the closed root bootstrap, which sees EOF, never a shell.
		control.Close()
		child.Close()
		if err == nil {
			return
		}
		if !started {
			err = errors.Join(err, e.discardUnstartedPane(unit, proof))
			return
		}
		if launch.Process != nil {
			_ = launch.Process.Kill() // exact owned process handle, not PID/name search.
			_ = launch.Wait()
		}
		closed := p.authority
		closed.Units = []string{unit}
		if cleanupErr := e.terminateWriters(&closed); cleanupErr != nil {
			err = errors.Join(err, errors.New("startup cleanup unconfirmed; recorded scope retained; inspect examctl panes list ATTEMPT and preserve work"))
			return
		}
		err = errors.Join(err, e.WithState(func() error {
			if a := e.state.Attempts[p.capability.ID]; a != nil {
				removePaneUnit(e.state.PaneInstances, a, unit)
			}
			return nil
		}))
	}()
	args, err := paneBootstrapArgs(launch.Args[1:], unit, proof.ClosedUntil, proof.ClosedBootUntil)
	if err != nil {
		return false, err
	}
	launch.Args = append([]string{launch.Path}, args...)
	launch.ExtraFiles = []*os.File{child, executable}
	var peer *paneBootstrapPeer
	if e.paneBootstrapStart != nil {
		peer, started, err = e.paneBootstrapStart(launch, control, executable, unit, proof)
	} else {
		start := launch.Start
		if e.paneStart != nil {
			start = e.paneStart
		}
		if err := start(); err != nil {
			return false, err
		}
		started = true
		child.Close()
		peer, err = awaitPaneBootstrap(control, executable, unit, proof.ClosedUntil, proof.ClosedBootUntil)
	}
	if err != nil {
		return started, err
	}
	if peer == nil || peer.process == nil {
		return started, errPaneBootstrap
	}
	defer peer.process.close()
	if err := bridge(peer); err != nil {
		return true, err
	}
	err = e.releaseClosedPane(p, name, unit, proof, identify, peer.current, func() error {
		_, err := control.Write([]byte{1})
		if err != nil {
			return err
		}
		return control.Close()
	})
	return true, err
}
