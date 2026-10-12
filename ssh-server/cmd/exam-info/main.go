package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Printf("Exam: %s\nSaved directory: %s\nDeadline: %s\nSaved files in this directory are collected automatically when time expires or you finish the exam. Unsaved editor buffers are not included. No submission command or upload is needed. The deadline never pauses.\n", os.Getenv("EXAM_ID"), os.Getenv("EXAM_DIR"), os.Getenv("EXAM_DEADLINE"))
}
