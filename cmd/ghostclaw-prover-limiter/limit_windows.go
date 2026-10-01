//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

func executeWithMemoryLimit(limit uint64, program string, args []string) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return fmt.Errorf("cannot create prover job: %w", err)
	}
	defer windows.CloseHandle(job)

	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags =
		windows.JOB_OBJECT_LIMIT_PROCESS_MEMORY | windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	info.ProcessMemoryLimit = uintptr(limit)
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		return fmt.Errorf("cannot set prover memory limit: %w", err)
	}

	command := exec.Command(program, args[1:]...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Env = os.Environ()
	if err := command.Start(); err != nil {
		return err
	}
	process, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(command.Process.Pid),
	)
	if err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return fmt.Errorf("cannot open prover process: %w", err)
	}
	defer windows.CloseHandle(process)
	if err := windows.AssignProcessToJobObject(job, process); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return fmt.Errorf("cannot apply prover memory limit: %w", err)
	}
	return command.Wait()
}
