package core

// A registered page is identity metadata, not a monitoring permit, actor seal,
// freeze receipt or permission reconstructed from disk. Positive operations
// still require their existing current peer/account/lease/deadline checks.
import "errors"

var errRegisteredOwner = errors.New("registered page owner is missing, changed or inconsistent; preserve the original attempt/deadline and inspect examctl info ATTEMPT --read-only; restore the same authorized page or use the supported approved continuation, never reset the clock")

func registerPageOwner(a *Attempt, page, epoch string) error {
	if a == nil {
		return errRegisteredOwner
	}
	if page == "" && a.RegisteredOwner == nil {
		return nil
	}
	o := monitoringOwner{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, TransportHash: a.Transport, Boot: boot(), PageEpoch: page, InputEpoch: epoch, Generation: a.Generation, ClockRevision: a.ClockRevision}
	if !validMonitoringOwner(o) {
		return errRegisteredOwner
	}
	a.RegisteredOwner = &o
	return nil
}

func refreshRegisteredOwnerClock(a *Attempt) {
	if a.RegisteredOwner != nil {
		o := *a.RegisteredOwner // Never mutate an immutable pane snapshot's pointer.
		o.ClockRevision = a.ClockRevision
		a.RegisteredOwner = &o
	}
}

func currentRegisteredOwner(a *Attempt) bool {
	if a == nil || a.RegisteredOwner == nil {
		return false
	}
	o := *a.RegisteredOwner
	return validMonitoringOwner(o) && o.Attempt == a.ID && o.Exam == a.Exam && o.Username == a.Username && o.UID == a.UID && o.TransportHash == a.Transport && o.Boot == boot() && o.Generation == a.Generation && o.ClockRevision == a.ClockRevision
}

func requireRegisteredPage(a *Attempt, page string) error {
	if a == nil {
		return errRegisteredOwner
	}
	if a.RegisteredOwner == nil {
		return nil
	} // Existing legacy mode; no backfill.
	if !currentRegisteredOwner(a) || page != a.RegisteredOwner.PageEpoch {
		return errRegisteredOwner
	}
	return nil
}
