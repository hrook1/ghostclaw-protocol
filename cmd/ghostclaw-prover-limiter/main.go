package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	if len(os.Args) < 3 {
		fatalf("usage: ghostclaw-prover-limiter <memory-bytes> <program> [args...]")
	}
	limit, err := strconv.ParseUint(os.Args[1], 10, 64)
	if err != nil || limit < 1024*1024 {
		fatalf("invalid memory limit")
	}
	if err := executeWithMemoryLimit(limit, os.Args[2], os.Args[2:]); err != nil {
		fatalf("cannot start the limited prover: %v", err)
	}
}

func fatalf(format string, values ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", values...)
	os.Exit(1)
}
