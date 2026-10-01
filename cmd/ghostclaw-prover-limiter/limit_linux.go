//go:build linux

package main

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func executeWithMemoryLimit(limit uint64, program string, args []string) error {
	resourceLimit := new(unix.Rlimit)
	if err := unix.Getrlimit(unix.RLIMIT_AS, resourceLimit); err != nil {
		return fmt.Errorf("cannot read address-space limit: %w", err)
	}
	if resourceLimit.Max != unix.RLIM_INFINITY && limit > resourceLimit.Max {
		limit = resourceLimit.Max
	}
	resourceLimit.Cur = limit
	if err := unix.Setrlimit(unix.RLIMIT_AS, resourceLimit); err != nil {
		return fmt.Errorf("cannot set address-space limit: %w", err)
	}
	return unix.Exec(program, args, os.Environ())
}
