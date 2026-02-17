# Container Visualize

**A lightweight Go tool that lets you browse, edit, and manage any Docker container's filesystem from your browser.**

Run any container. Point `containervisualize` at it. Instantly get an interactive file explorer in your browser — no exec, no SSH, no fuss.

---

## What It Does

Container Visualize connects to a running Docker container and serves a web-based file explorer that lets you:

- **Browse** the full directory tree with expand/collapse navigation
- **View** any file with syntax highlighting (code, config, logs, markdown)
- **Edit** text-based files directly in the browser with a built-in editor
- **Upload** files from your local machine into the container
- **Delete** files and directories with confirmation
- **Download** individual files or entire directories as tar archives
- **Search** across filenames and directory paths
- **Monitor** container metadata (image, status, resource usage)

All of this ships as a **single static binary** with the web UI embedded — no Node.js, no npm, no external dependencies.

## Quick Start

```bash
# Install
go install github.com/dalinkstone/containervisualize@latest

# Start any container
docker run -d --name my-app nginx:latest

# Visualize it
containervisualize --container my-app

# Open http://localhost:9500 in your browser
```

Or visualize by container ID:

```bash
containervisualize --container a1b2c3d4
```

## Usage

```
containervisualize [flags]

Flags:
  --container, -c    Container name or ID (required)
  --port, -p         Port to serve the web UI (default: 9500)
  --host             Host to bind to (default: 127.0.0.1)
  --readonly          Disable write operations (upload, edit, delete)
  --depth             Max directory depth to scan initially (default: 3)
  --docker-host       Docker daemon socket (default: unix:///var/run/docker.sock)
  --no-open           Don't auto-open the browser
  --verbose, -v       Verbose logging
```

## Examples

```bash
# Read-only exploration of a production container
containervisualize -c prod-api --readonly

# Visualize on a custom port, bind to all interfaces
containervisualize -c my-app -p 3000 --host 0.0.0.0

# Connect to remote Docker daemon
containervisualize -c my-app --docker-host tcp://192.168.1.100:2375
```

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ File Tree │  │  Editor  │  │  Toolbar  │ │
│  └─────┬────┘  └─────┬────┘  └─────┬─────┘ │
│        └──────────┬──┘              │        │
│              REST API + WebSocket   │        │
└──────────────────┬──────────────────┘        │
                   │                            
┌──────────────────▼──────────────────┐        
│         Go HTTP Server              │        
│  ┌────────────┐  ┌───────────────┐  │        
│  │ API Router │  │ Static Assets │  │        
│  └─────┬──────┘  │  (embedded)   │  │        
│        │         └───────────────┘  │        
│  ┌─────▼──────────────────────┐     │        
│  │   Container Service Layer  │     │        
│  │  (read, write, delete,     │     │        
│  │   list, stat, archive)     │     │        
│  └─────┬──────────────────────┘     │        
│        │                            │        
│  ┌─────▼──────────────────────┐     │        
│  │   Docker Engine SDK        │     │        
│  │  (CopyFrom, CopyTo, Exec) │     │        
│  └─────┬──────────────────────┘     │        
└────────┼────────────────────────────┘        
         │                                      
    ┌────▼─────┐                               
    │  Docker  │                               
    │  Daemon  │                               
    └────┬─────┘                               
         │                                      
    ┌────▼──────────┐                          
    │   Container   │                          
    │  Filesystem   │                          
    └───────────────┘                          
```

## Security

- **Localhost-only by default** — binds to `127.0.0.1`, not `0.0.0.0`
- **Read-only mode** — `--readonly` flag disables all mutation operations
- **Path traversal protection** — all file paths are sanitized and resolved
- **Upload size limits** — configurable max upload size (default 50MB)
- **No shell access** — uses Docker SDK copy operations, never spawns shells in containers
- **Container isolation** — only accesses the specified container, cannot pivot

## Tech Stack

- **Backend:** Go 1.22+, Docker Engine SDK, `net/http` stdlib router, `embed` for static assets
- **Frontend:** Vanilla JavaScript, CSS — zero framework dependencies
- **Editor:** CodeMirror 6 (loaded from CDN) for syntax highlighting and editing
- **Build:** Single `go build` produces a fully self-contained binary

## Development

```bash
git clone https://github.com/dalinkstone/containervisualize.git
cd containervisualize
go mod tidy
go run ./cmd/containervisualize --container my-app
```

## License

MIT
