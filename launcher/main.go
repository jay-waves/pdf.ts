package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	args := os.Args[1:]
	if err := run(args); err != nil {
		if len(args) == 1 && args[0] == "daemon" {
			_ = RecordDaemonError("", err)
			os.Exit(1)
		}
		ReportError("pdf.ts", err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return openViewer("")
	}
	switch args[0] {
	case "start":
		if len(args) != 1 {
			return usageError()
		}
		return startDaemon()
	case "daemon":
		if len(args) != 1 {
			return usageError()
		}
		return runDaemon()
	case "stop":
		if len(args) != 1 {
			return usageError()
		}
		return StopDaemon("")
	case "status":
		if len(args) != 1 {
			return usageError()
		}
		return printStatus()
	case "open":
		if len(args) > 2 {
			return usageError()
		}
		if len(args) == 1 {
			return openViewer("")
		}
		return openViewer(args[1])
	case "install":
		if len(args) != 1 {
			return usageError()
		}
		executable, err := os.Executable()
		if err != nil {
			return fmt.Errorf("locate pdf.ts executable: %w", err)
		}
		return Install(executable)
	case "uninstall":
		if len(args) > 2 || len(args) == 2 && args[1] != "--purge" {
			return usageError()
		}
		return Uninstall(len(args) == 2)
	default:
		return usageError()
	}
}

func printStatus() error {
	running, err := DaemonRunning("")
	if err != nil {
		return err
	}
	if running {
		fmt.Println("running")
		return nil
	}
	fmt.Println("stopped")
	failure, err := LastDaemonError("")
	if err != nil {
		return err
	}
	if failure != nil {
		fmt.Printf("last error: %s\n", failure.Error)
		fmt.Printf("failed at: %s\n", failure.FailedAt.Format(time.RFC3339))
	}
	return nil
}

func usageError() error {
	return errors.New("usage: pdf.ts <start|daemon|status|stop|open [document]|install|uninstall [--purge]>")
}

func openViewer(argument string) error {
	var documentPath string
	var err error
	if argument != "" {
		documentPath, err = ResolveTarget(argument)
		if err != nil {
			return err
		}
	}

	if err := startDaemon(); err != nil {
		return err
	}
	var viewerURL string
	if documentPath == "" {
		viewerURL, err = WelcomeURL("")
	} else {
		viewerURL, err = RegisterWithDaemon("", documentPath)
	}
	if err != nil {
		return err
	}
	if err := OpenBrowser(viewerURL); err != nil {
		return fmt.Errorf("open browser: %w", err)
	}
	return nil
}

func startDaemon() error {
	running, err := DaemonRunning("")
	if err != nil {
		return err
	}
	if running {
		return nil
	}

	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate pdf.ts executable: %w", err)
	}
	if err := StartBackgroundProcess(executable, "daemon"); err != nil {
		return fmt.Errorf("start pdf.ts daemon: %w", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	var lastError error
	for time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
		running, err = DaemonRunning("")
		if err != nil {
			lastError = err
			continue
		}
		if running {
			return nil
		}
	}
	if lastError != nil {
		return fmt.Errorf("pdf.ts daemon did not become ready: %w", lastError)
	}
	return errors.New("pdf.ts daemon did not become ready within 10 seconds")
}

func runDaemon() error {
	app, err := New()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	_, err = app.Start(ctx)
	if err != nil {
		return err
	}
	_ = ClearDaemonError("")
	return app.Wait()
}
