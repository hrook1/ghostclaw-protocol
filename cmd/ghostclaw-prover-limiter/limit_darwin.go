//go:build darwin

package main

/*
#cgo LDFLAGS: -lproc
#include <libproc.h>
#include <stdint.h>
#include <sys/proc_info.h>

static int ghostclaw_resident_bytes(int pid, uint64_t *result) {
	struct proc_taskinfo info;
	int size = proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, sizeof(info));
	if (size != sizeof(info)) return -1;
	*result = info.pti_resident_size;
	return 0;
}
*/
import "C"

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

// Darwin rejects finite RLIMIT_AS values. This supervisor enforces the same
// ceiling from outside the prover and fails closed when usage cannot be read.
func executeWithMemoryLimit(limit uint64, program string, args []string) error {
	command := exec.Command(program, args[1:]...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Env = os.Environ()
	if err := command.Start(); err != nil {
		return err
	}

	stopped := make(chan error, 1)
	go func() { stopped <- command.Wait() }()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case err := <-stopped:
			return err
		case received := <-signals:
			_ = command.Process.Signal(received)
			return <-stopped
		case <-ticker.C:
			resident, err := residentBytes(command.Process.Pid)
			if err != nil {
				_ = command.Process.Kill()
				<-stopped
				return fmt.Errorf("cannot read prover memory use: %w", err)
			}
			if resident > limit {
				_ = command.Process.Kill()
				<-stopped
				return fmt.Errorf("prover exceeded its %d-byte memory limit", limit)
			}
		}
	}
}

func residentBytes(pid int) (uint64, error) {
	var result C.uint64_t
	if C.ghostclaw_resident_bytes(C.int(pid), &result) != 0 {
		return 0, errors.New("macOS did not return the prover memory use")
	}
	return uint64(result), nil
}
