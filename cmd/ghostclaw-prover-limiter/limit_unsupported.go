//go:build !linux && !darwin && !windows

package main

import "errors"

func executeWithMemoryLimit(_ uint64, _ string, _ []string) error {
	return errors.New("this operating system has no supported GhostClaw memory limiter")
}
