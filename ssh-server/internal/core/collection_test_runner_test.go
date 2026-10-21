package core

// Ordinary core tests replace privileged process/systemd setup only. Every job
// still uses real per-attempt/slot flocks, short state commits and archive IO.
// collection_process_test.go separately exercises real fatal child processes.
func init() {
	collectionRunner = func(e *Engine) func(string, string) error {
		return func(action, id string) error {
			worker, err := New(e.Config)
			if err != nil {
				return err
			}
			worker.quiesce, worker.terminate = e.quiesce, e.terminate
			worker.workspaceCheckpoint = e.workspaceCheckpoint
			return worker.runCollectionJob(action, id)
		}
	}
}
