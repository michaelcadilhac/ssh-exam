package core

const SandboxExamID = "sandbox"
const SandboxDurationSeconds int64 = 300

func sandboxAttempt(a *Attempt) bool { return a.Exam == SandboxExamID }
