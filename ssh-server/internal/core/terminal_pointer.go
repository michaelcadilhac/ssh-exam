package core

import "unsafe"

func unsafePointer(p *windowSize) unsafe.Pointer { return unsafe.Pointer(p) }
