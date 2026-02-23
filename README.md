# Container Visualize

**A lightweight Go tool that lets you browse, edit, and manage any Docker container's filesystem from your browser.**

Run any container. Point `containervisualize` at it. Instantly get an interactive file explorer in your browser — no exec, no SSH, no fuss.

---

## What It Does

Container Visualize connects to a running Docker container and serves a web-based file explorer that lets you:

- **Browse** the full directory tree with expand/collapse navigation
- **View** any file with syntax highlighting (code, config, logs, markdown)
- **Edit** text files directly in the browser with CodeMirror and save back to the container
- **Upload** files from your local machine into the container (drag-and-drop or file picker)
- **Delete** files and directories with confirmation dialogs
- **Download** individual files or entire directories as `.tar.gz` archives
- **Search** filenames or file contents across the container filesystem
- **Toggle** between dark (Catppuccin Mocha) and light themes

All of this ships as a **single static binary** with the web UI embedded — no Node.js, no npm, no external dependencies.

---

## Prerequisites

- **Docker** — Docker Engine must be running and accessible (via the default socket or a remote host)
- **A running container** — you need at least one container to visualize

---

## Quick Start

### Option 1: Install with Go

```bash
go install github.com/dalinkstone/containervisualize@latest
```

### Option 2: Download a release binary

Download the latest binary for your platform from [GitHub Releases](https://github.com/dalinkstone/containervisualize/releases), then make it executable:

```bash
chmod +x containervisualize-darwin-arm64
mv containervisualize-darwin-arm64 /usr/local/bin/containervisualize
```

### Option 3: Build from source

```bash
git clone https://github.com/dalinkstone/containervisualize.git
cd containervisualize
make build
# Binary is at ./bin/containervisualize
```

### Option 4: Run with Docker

```bash
docker build -t containervisualize .
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 9500:9500 \
  containervisualize --container my-app --host 0.0.0.0
```

The Docker socket mount (`-v /var/run/docker.sock:...`) is required so the tool can inspect other containers. `--host 0.0.0.0` is required when running inside a container so the port mapping works.

---

## Getting Started

1. Start a container you want to explore:

```bash
docker run -d --name my-app nginx:latest
```

2. Point `containervisualize` at it:

```bash
containervisualize --container my-app
```

3. Your browser opens automatically to `http://localhost:9500`. You'll see:
   - A **file tree** on the left — click directories to expand, click files to view
   - A **code editor** on the right — syntax-highlighted with CodeMirror, edit and save with Ctrl+S
   - A **toolbar** at the top — search files (Ctrl+P), upload, download, toggle dark/light theme
   - A **status bar** at the bottom — connection status, file info, container status

4. Right-click any file or directory for a context menu with options to download, delete, upload, or create new files.

---

## Usage

```
containervisualize [flags]

Flags:
  --container, -c    Container name or ID (required)
  --port, -p         Port to serve the web UI (default: 9500)
  --host             Host to bind to (default: 127.0.0.1)
  --readonly         Disable all write operations (upload, edit, delete)
  --depth            Default tree depth (default: 3)
  --docker-host      Docker daemon socket (default: auto-detect)
  --no-open          Don't auto-open the browser
  --verbose, -v      Enable verbose logging
  --version          Print version and exit
```

## Examples

```bash
# Read-only exploration of a production container
containervisualize -c prod-api --readonly

# Custom port, bind to all interfaces
containervisualize -c my-app -p 3000 --host 0.0.0.0

# Connect to a remote Docker daemon
containervisualize -c my-app --docker-host tcp://192.168.1.100:2375

# Visualize by container ID
containervisualize -c a1b2c3d4

# Check the installed version
containervisualize --version
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+S` | Save current file |
| `Ctrl/Cmd+P` | Focus search input |
| `Ctrl/Cmd+Shift+E` | Focus file tree |
| `Escape` | Close search results / context menu / dialog |
| `Delete/Backspace` | Delete selected tree node (with confirmation) |

---

## API Endpoints

The web UI communicates with a REST API. You can also use these endpoints directly:

```
GET    /api/container             Container metadata (name, image, status)
GET    /api/tree?path=/           List directory contents
GET    /api/file?path=...         Read file contents
PUT    /api/file?path=...         Update file (body = new content)
POST   /api/file?path=...         Upload file (multipart form)
DELETE /api/file?path=...         Delete file or directory
GET    /api/archive?path=...      Download as file or .tar.gz archive
GET    /api/search?q=...&path=/   Search filenames (prefix q with "content:" for grep)
```

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                   Browser                     │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ File Tree │  │  Editor  │  │  Toolbar   │ │
│  └─────┬────┘  └─────┬────┘  └─────┬──────┘ │
│        └──────────┬───┘             │         │
│              REST API               │         │
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼───────────────────┐
│          Go HTTP Server              │
│  ┌─────────────┐  ┌───────────────┐  │
│  │  API Router  │  │ Static Assets │  │
│  └──────┬──────┘  │  (embedded)   │  │
│         │         └───────────────┘  │
│  ┌──────▼───────────────────────┐    │
│  │   Docker Client Layer        │    │
│  │  (list, read, write, delete, │    │
│  │   stat, archive, search)     │    │
│  └──────┬───────────────────────┘    │
│         │                            │
│  ┌──────▼───────────────────────┐    │
│  │   Docker Engine SDK          │    │
│  │  (CopyFrom, CopyTo, Exec)   │    │
│  └──────┬───────────────────────┘    │
└─────────┼────────────────────────────┘
          │
     ┌────▼──────┐
     │  Docker   │
     │  Daemon   │
     └────┬──────┘
          │
     ┌────▼───────────┐
     │   Container    │
     │  Filesystem    │
     └────────────────┘
```

---

## Security

- **Localhost-only by default** — binds to `127.0.0.1`, not `0.0.0.0`
- **Read-only mode** — `--readonly` flag disables all mutation operations at the middleware level
- **Path traversal protection** — all paths are cleaned, validated as absolute, and checked for `..` components
- **Upload size limits** — 50MB max via `http.MaxBytesReader`
- **No shell spawning** — exec commands are fixed strings (`ls`, `rm`, `find`, `grep`) with user input passed only as arguments via `[]string` (never shell strings), with `--` separators to prevent flag injection
- **Root delete protection** — deleting `/` is explicitly rejected

---

## Tech Stack

- **Backend:** Go 1.24, Docker Engine SDK, `net/http` stdlib router (Go 1.22 method+pattern matching), `go:embed` for static assets, `log/slog` for structured logging
- **Frontend:** Vanilla JavaScript (ES modules), CSS custom properties — zero framework dependencies
- **Editor:** CodeMirror 5 loaded from CDN (`cdnjs.cloudflare.com`), with `<textarea>` fallback if CDN is unreachable
- **Build:** Single `go build` produces a fully self-contained binary — no Node.js, no bundler

---

## Development

```bash
git clone https://github.com/dalinkstone/containervisualize.git
cd containervisualize

# Build
make build                    # → bin/containervisualize

# Run in development
make dev CONTAINER=my-app     # runs with --verbose

# Run unit tests
make test

# Run integration tests (requires Docker)
make test-integration

# Lint
make lint                     # requires golangci-lint

# Format
make fmt

# Build Docker image
make docker

# Cross-compile release binaries
make release                  # → bin/containervisualize-{os}-{arch}
```

---

## Project Structure

```
containervisualize/
├── cmd/containervisualize/
│   └── main.go                          # Entry point, CLI flags, server startup
├── internal/
│   ├── api/
│   │   ├── handlers.go                  # HTTP request handlers
│   │   ├── middleware.go                # Logging, readonly, path validation
│   │   ├── middleware_test.go           # Middleware unit tests
│   │   ├── responses.go                # JSON response helpers
│   │   └── router.go                   # Route registration
│   ├── docker/
│   │   ├── client.go                    # Docker SDK client wrapper
│   │   ├── container.go                # Container metadata queries
│   │   ├── filesystem.go               # File operations (list, read, write, delete, search)
│   │   ├── filesystem_test.go          # Unit tests
│   │   └── filesystem_integration_test.go  # Integration tests (testcontainers-go)
│   └── model/
│       └── types.go                     # Shared types (FileNode, ContainerInfo, APIError)
├── web/
│   ├── embed.go                         # go:embed directives
│   └── static/
│       ├── index.html                   # Single-page app shell
│       ├── css/style.css               # All styles (dark/light themes)
│       └── js/
│           ├── api.js                   # Backend API fetch wrapper
│           ├── app.js                   # App init, state, keyboard shortcuts
│           ├── codemirror-loader.js     # Dynamic CDN loader for CodeMirror 5
│           ├── editor.js               # CodeMirror editor wrapper
│           ├── toolbar.js              # Search, theme toggle, upload controls
│           └── tree.js                 # File tree with context menus
├── .github/workflows/
│   ├── ci.yml                           # CI: test, lint, integration
│   └── release.yml                     # Release on tag push
├── Dockerfile                           # Multi-stage build
├── Makefile                             # Build, test, lint, release, docker targets
├── go.mod
├── go.sum
├── CLAUDE.md                            # Claude Code instructions
├── IMPLEMENTATION.md                   # Architecture and design document
├── PLAN.md                              # Build execution plan (phase prompts)
└── README.md                            # This file
```

---

## License

MIT
