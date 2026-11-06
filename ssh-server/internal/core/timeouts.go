package core

import "time"

// Network/control waits share one budget. Worker resource and kernel cutoff
// bounds remain independent; a timeout never proves student misconduct.
const operationTimeout = 60 * time.Second
const operationTimeoutMS int64 = 60000
