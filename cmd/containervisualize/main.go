package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/dalinkstone/containervisualize/internal/api"
	"github.com/dalinkstone/containervisualize/internal/docker"
	"github.com/dalinkstone/containervisualize/web"
)

func main() {
	// CLI flags
	containerFlag := flag.String("container", "", "container ID or name (required)")
	flag.StringVar(containerFlag, "c", "", "container ID or name (shorthand)")

	portFlag := flag.Int("port", 8080, "HTTP server port")
	flag.IntVar(portFlag, "p", 8080, "HTTP server port (shorthand)")

	hostFlag := flag.String("host", "127.0.0.1", "HTTP server bind address")
	readonlyFlag := flag.Bool("readonly", false, "disable write operations")
	depthFlag := flag.Int("depth", 3, "default tree depth")
	dockerHostFlag := flag.String("docker-host", "", "Docker daemon host (empty = use default)")
	noOpenFlag := flag.Bool("no-open", false, "don't open browser on startup")

	verboseFlag := flag.Bool("verbose", false, "enable verbose logging")
	flag.BoolVar(verboseFlag, "v", false, "enable verbose logging (shorthand)")

	flag.Parse()

	// Validate required flags
	if *containerFlag == "" {
		fmt.Fprintln(os.Stderr, "error: --container/-c flag is required")
		fmt.Fprintln(os.Stderr)
		flag.Usage()
		os.Exit(1)
	}

	// Configure logging
	logLevel := slog.LevelInfo
	if *verboseFlag {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: logLevel,
	})))

	// Silence the depth flag unused warning by logging it
	slog.Debug("configuration", "depth", *depthFlag)

	// Initialize Docker client
	dockerClient, err := docker.NewDockerClient(*dockerHostFlag)
	if err != nil {
		slog.Error("failed to create docker client", "error", err)
		os.Exit(1)
	}
	defer dockerClient.Close()

	// Verify Docker connectivity
	ctx := context.Background()
	if err := dockerClient.Ping(ctx); err != nil {
		slog.Error("cannot connect to docker", "error", err)
		os.Exit(1)
	}

	// Verify container exists and is running
	info, err := dockerClient.GetContainerInfo(ctx, *containerFlag)
	if err != nil {
		slog.Error("container error", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to container", "name", info.Name, "image", info.Image, "status", info.Status)

	// Set up embedded static filesystem
	staticFS, err := fs.Sub(web.StaticFS, "static")
	if err != nil {
		slog.Error("failed to set up static filesystem", "error", err)
		os.Exit(1)
	}

	// Create router
	handler := api.NewRouter(dockerClient, *containerFlag, *readonlyFlag, staticFS)

	// Create HTTP server
	addr := fmt.Sprintf("%s:%d", *hostFlag, *portFlag)
	server := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	url := fmt.Sprintf("http://%s:%d", *hostFlag, *portFlag)
	if *hostFlag == "0.0.0.0" {
		url = fmt.Sprintf("http://localhost:%d", *portFlag)
	}

	// Start server in background
	go func() {
		slog.Info("starting server", "addr", addr, "url", url)
		fmt.Printf("\n  Container Visualize\n  %s\n  Container: %s (%s)\n\n", url, info.Name, info.Image)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Open browser
	if !*noOpenFlag {
		go openBrowser(url)
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}

// openBrowser attempts to open the given URL in the default browser.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return
	}
	cmd.Run()
}
