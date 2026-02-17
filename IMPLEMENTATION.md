# Implementation Plan — Container Visualize

This document describes the engineering design, architecture decisions, and implementation details for Container Visualize.

---

## 1. Design Principles

Three principles govern every decision:

**Security first.** The tool interacts with Docker containers, which means it touches real filesystems. Every API endpoint validates and sanitizes paths. Localhost binding is the default. Read-only mode exists for when you just want to look. No shell spawning — we use Docker SDK copy primitives exclusively.

**Single binary simplicity.** One `go build`, one binary, zero runtime dependencies. The web frontend is embedded at compile time using Go's `embed` package. No Node.js build step, no sidecar process, no config files required. Run it and go.

**Lazy efficiency.** Don't scan the entire container filesystem upfront. Load directory contents on-demand as the user expands tree nodes. Stream file contents rather than buffering entire files into memory. Use tar archives (Docker's native copy format) directly instead of converting between formats unnecessarily.

---

## 2. Project Structure

```
containervisualize/
├── cmd/
│   └── containervisualize/
│       └── main.go                 # Entry point, CLI flag parsing, server startup
├── internal/
│   ├── docker/
│   │   ├── client.go               # Docker SDK client wrapper
│   │   ├── filesystem.go           # File tree operations (list, stat, read, write, delete)
│   │   └── container.go            # Container info and lifecycle queries
│   ├── api/
│   │   ├── router.go               # HTTP route registration
│   │   ├── handlers.go             # Request handlers for all endpoints
│   │   ├── middleware.go           # Logging, CORS, readonly enforcement, path validation
│   │   └── responses.go            # Standardized JSON response helpers
│   └── model/
│       └── types.go                # Shared types (FileNode, ContainerInfo, etc.)
├── web/
│   ├── embed.go                    # go:embed directives for static assets
│   ├── static/
│   │   ├── index.html              # Single-page app shell
│   │   ├── css/
│   │   │   └── style.css           # All styles — file tree, editor, toolbar, layout
│   │   └── js/
│   │       ├── app.js              # App initialization and state management
│   │       ├── tree.js             # File tree component — expand, collapse, context menu
│   │       ├── editor.js           # CodeMirror wrapper — load, save, syntax detection
│   │       ├── toolbar.js          # Upload, download, delete, search controls
│   │       └── api.js              # Fetch wrapper for all backend API calls
├── go.mod
├── go.sum
├── Makefile                        # Build, test, lint, release targets
├── Dockerfile                      # For building the tool itself (not the target container)
├── README.md
├── IMPLEMENTATION.md
└── PLAN.md
```

This is flat where it can be and nested where it needs to be. No `pkg/` directory, no `util/` grab bag. Every directory has a clear reason to exist.

---

## 3. Backend Design

### 3.1 Docker Client Layer (`internal/docker/`)

The Docker client layer wraps the official `github.com/docker/docker/client` SDK. It exposes a clean interface that the API handlers consume.

**Key interface:**

```go
type ContainerFS interface {
    // ListDir returns the immediate children of a directory path.
    ListDir(ctx context.Context, containerID, path string) ([]FileNode, error)
    
    // ReadFile returns the contents of a file as an io.ReadCloser.
    ReadFile(ctx context.Context, containerID, path string) (io.ReadCloser, int64, error)
    
    // WriteFile writes content to a path inside the container.
    WriteFile(ctx context.Context, containerID, path string, content io.Reader, size int64) error
    
    // DeletePath removes a file or directory (recursive).
    DeletePath(ctx context.Context, containerID, path string) error
    
    // StatPath returns metadata about a single path.
    StatPath(ctx context.Context, containerID, path string) (*FileNode, error)
    
    // ArchiveDir returns a tar stream of a directory.
    ArchiveDir(ctx context.Context, containerID, path string) (io.ReadCloser, error)
    
    // ContainerInfo returns metadata about the container.
    ContainerInfo(ctx context.Context, containerID string) (*ContainerInfo, error)
}
```

**Implementation details:**

- **ListDir** uses `container.ExecCreate` + `ExecStart` to run `ls -la --time-style=full-iso` inside the container. This is the one place we use exec, and it's a read-only, non-interactive command. The alternative — copying the entire directory via `CopyFromContainer` and inspecting the tar headers — is wasteful for large directories. We parse the ls output server-side.
  
  *Fallback:* If exec fails (e.g., container has no `ls` binary — think `FROM scratch`), fall back to `CopyFromContainer` on the directory path and read tar headers only (discard file contents). This handles minimal containers gracefully.

- **ReadFile** uses `CopyFromContainer`, which returns a tar stream. We extract the single file from the tar and stream it to the caller. No buffering the whole file into memory.

- **WriteFile** creates a tar archive in memory containing the single file, then uses `CopyToContainer` to write it. Docker's copy API is tar-native, so this is the natural approach.

- **DeletePath** uses `ExecCreate` to run `rm -rf <path>`. This is the only destructive exec. The path is sanitized and validated before reaching this point.

### 3.2 API Layer (`internal/api/`)

Standard REST over HTTP using Go's `net/http` with the 1.22 routing enhancements (method + pattern matching).

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/container` | Container metadata (name, image, status, created) |
| `GET` | `/api/tree?path=/&depth=1` | List directory contents at path |
| `GET` | `/api/file?path=/etc/nginx.conf` | Read file contents |
| `PUT` | `/api/file?path=/etc/nginx.conf` | Update file contents (body = new content) |
| `POST` | `/api/file?path=/tmp/` | Upload file(s) to directory (multipart form) |
| `DELETE` | `/api/file?path=/tmp/old.log` | Delete file or directory |
| `GET` | `/api/archive?path=/etc/` | Download directory as .tar.gz |
| `GET` | `/api/search?q=nginx&path=/` | Search filenames under path |
| `GET` | `/` | Serve the embedded web UI |

**Why no WebSocket for file watching?**  
Initially I considered WebSocket-based filesystem watching, but it adds significant complexity. Docker doesn't provide filesystem event streams natively — we'd have to poll via exec or use inotifywait inside the container (which may not exist). For v1, the tree refreshes on user action. A manual "Refresh" button handles staleness. WebSocket watching can be a v2 feature using `fsnotify` inside an exec session if the container supports it.

### 3.3 Middleware

Three middleware functions, applied in order:

1. **Logger** — Logs method, path, status code, and duration for every request. Uses `slog` (stdlib structured logging).

2. **ReadOnly enforcer** — If `--readonly` flag is set, rejects any `PUT`, `POST`, or `DELETE` to `/api/*` with 403 Forbidden. Simple and bulletproof.

3. **Path sanitizer** — For any request that includes a `path` query parameter:
   - Calls `filepath.Clean()` to normalize
   - Rejects paths containing `..` after cleaning
   - Ensures path is absolute (starts with `/`)
   - Rejects null bytes and other injection characters
   
   This runs before the handler ever sees the path.

### 3.4 Error Handling

All errors map to structured JSON responses:

```json
{
  "error": "file not found",
  "path": "/etc/missing.conf",
  "status": 404
}
```

Docker SDK errors are mapped to appropriate HTTP codes: container not found → 404, permission denied → 403, container not running → 409 Conflict.

---

## 4. Frontend Design

### 4.1 Philosophy

The frontend is vanilla JavaScript. No React, no Vue, no build step. The reasons:

- It embeds cleanly with `go:embed` — no `node_modules`, no webpack output
- The UI is fundamentally simple: a tree on the left, a viewer/editor on the right, a toolbar on top
- CodeMirror 6 (loaded from CDN with a local fallback) handles the heavy lifting for the editor
- Total JS payload target: under 50KB gzipped (excluding CodeMirror)

### 4.2 Layout

```
┌─────────────────────────────────────────────────────┐
│  [Container: nginx:latest]  [⟳ Refresh] [📤 Upload] │  ← Toolbar
├────────────────────┬────────────────────────────────┤
│  📁 /              │                                 │
│  ├── 📁 etc/       │   /etc/nginx/nginx.conf         │
│  │   ├── 📁 nginx/ │   ──────────────────────────    │
│  │   │   ├── 📄 ng…│   worker_processes  1;          │  ← Editor/Viewer
│  │   │   └── 📁 co…│   events {                      │
│  │   ├── 📄 hosts  │       worker_connections 1024;  │
│  │   └── 📄 passwd │   }                             │
│  ├── 📁 var/       │   http {                        │
│  │   └── 📁 log/   │       ...                       │
│  └── 📁 usr/       │                                 │
│                    │   [Save] [Download] [Delete]    │
├────────────────────┴────────────────────────────────┤
│  Status: Connected │ Size: 2.4 KB │ UTF-8           │  ← Status bar
└─────────────────────────────────────────────────────┘
```

### 4.3 File Tree Component (`tree.js`)

The tree loads lazily. On initial page load, it fetches `GET /api/tree?path=/&depth=1` to get root-level entries. When the user clicks to expand a directory, it fetches that directory's children on demand.

**State model:**

```javascript
// Each node in the tree
{
  name: "nginx.conf",
  path: "/etc/nginx/nginx.conf",
  type: "file",         // "file" | "directory" | "symlink"
  size: 2431,
  modified: "2024-01-15T10:30:00Z",
  permissions: "-rw-r--r--",
  children: null,        // null = not loaded, [] = empty dir
  expanded: false
}
```

**Interactions:**
- Click file → load in editor/viewer panel
- Click directory → toggle expand/collapse, fetch children if not loaded
- Right-click → context menu (rename, delete, download, new file, new directory)
- Drag-and-drop files onto a directory → upload

### 4.4 Editor Component (`editor.js`)

For text files, we use CodeMirror 6 loaded from a CDN (`cdnjs.cloudflare.com`). If the CDN is unreachable (offline/air-gapped use), fall back to a plain `<textarea>` with monospace font.

**File type handling:**
- Text/code files (detected by extension + MIME sniffing): Open in CodeMirror with appropriate language mode
- Images (png, jpg, gif, svg, webp): Render inline with `<img>`
- Binary files: Show hex dump preview (first 1KB) with download button
- Large files (>5MB): Show metadata only with download button, don't load into editor
- Markdown: Rendered preview tab alongside the raw editor tab

**Save flow:** User edits → clicks Save (or Ctrl+S) → `PUT /api/file?path=...` with new content → success toast notification → tree refreshes the file's size/modified metadata.

### 4.5 Toolbar Component (`toolbar.js`)

- **Container badge** — Shows container name, image, and running status
- **Refresh button** — Reloads the currently expanded tree state
- **Upload button** — Opens file picker, uploads to the currently selected directory
- **Search** — Filter input that searches file/directory names client-side on the loaded tree, with a "deep search" button that queries `GET /api/search` for server-side filename search
- **Breadcrumb** — Shows the current path with clickable segments

### 4.6 Styling (`style.css`)

Dark theme by default (developers live in dark mode). Light theme toggle available. CSS custom properties for easy theming:

```css
:root {
  --bg-primary: #1e1e2e;
  --bg-secondary: #181825;
  --bg-surface: #313244;
  --text-primary: #cdd6f4;
  --text-secondary: #a6adc8;
  --accent: #89b4fa;
  --danger: #f38ba8;
  --success: #a6e3a1;
  --border: #45475a;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --font-sans: 'Inter', -apple-system, sans-serif;
}
```

The design leans into a Catppuccin Mocha-inspired palette. It should feel like a code editor, not a corporate dashboard.

---

## 5. Build and Distribution

### 5.1 Build Process

```makefile
# Makefile
VERSION := $(shell git describe --tags --always --dirty)

build:
	CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=$(VERSION)" \
		-o bin/containervisualize ./cmd/containervisualize

# Cross-compile for releases
release:
	GOOS=linux GOARCH=amd64 go build -o bin/containervisualize-linux-amd64 ./cmd/containervisualize
	GOOS=darwin GOARCH=arm64 go build -o bin/containervisualize-darwin-arm64 ./cmd/containervisualize
	GOOS=windows GOARCH=amd64 go build -o bin/containervisualize-windows-amd64.exe ./cmd/containervisualize
```

Since the frontend is vanilla JS with no build step, `go build` is literally the only build command. The `web/static/` directory is embedded at compile time via `//go:embed static/*` in `web/embed.go`.

### 5.2 Docker Image (for the tool itself)

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /containervisualize ./cmd/containervisualize

FROM alpine:3.19
COPY --from=builder /containervisualize /usr/local/bin/
ENTRYPOINT ["containervisualize"]
```

Usage: mount the Docker socket into the tool's container:

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -p 9500:9500 \
  containervisualize --container my-app --host 0.0.0.0
```

---

## 6. Security Model

### 6.1 Attack Surface Analysis

The primary risk is that this tool provides browser-based write access to a container's filesystem. Mitigations:

| Risk | Mitigation |
|------|-----------|
| Path traversal (`../../etc/shadow`) | `filepath.Clean` + reject `..` + absolute path enforcement |
| Unauthorized network access | Bind to `127.0.0.1` by default |
| Accidental production use | `--readonly` flag, prominent UI indicator when writes are enabled |
| Large file upload DoS | Configurable max upload size (default 50MB), `http.MaxBytesReader` |
| Container escape | We use Docker SDK copy/exec only — no mount, no privileged operations |
| Exec injection | All exec commands are hardcoded (`ls`, `rm`). User input is only passed as arguments to these fixed commands, never interpolated into shell strings |

### 6.2 Exec Safety

The `rm -rf` command for deletion is constructed as:

```go
execConfig := container.ExecOptions{
    Cmd: []string{"rm", "-rf", "--", sanitizedPath},
}
```

Note the `--` to prevent flag injection. The path has already been sanitized by middleware. We never construct shell command strings — `Cmd` takes an `[]string` that maps directly to `execve` arguments.

For `ls`, the same approach:

```go
execConfig := container.ExecOptions{
    Cmd: []string{"ls", "-la", "--time-style=full-iso", "--", sanitizedPath},
}
```

### 6.3 Future Considerations (v2+)

- Optional token-based authentication for non-localhost deployments
- TLS support via `--tls-cert` and `--tls-key` flags
- Audit logging of all write operations
- Per-path access control lists

---

## 7. Performance Considerations

- **Lazy tree loading** prevents scanning containers with millions of files (e.g., node_modules nightmares)
- **Streaming reads** — file contents are piped from Docker tar stream → HTTP response. No intermediate buffer for the full file.
- **Tar reuse** — Docker's copy API speaks tar natively. We work with tar streams directly rather than extracting to temp files.
- **Static asset caching** — Embedded assets served with `Cache-Control: max-age=31536000` and content-hash ETags. The binary itself is the cache-buster (new build = new hashes).
- **Connection reuse** — Single Docker client instance with persistent connection to the daemon.

---

## 8. Testing Strategy

- **Unit tests** for path sanitization, tar packing/unpacking, ls output parsing
- **Integration tests** using `testcontainers-go` — spin up a real container, exercise the full API
- **Frontend tests** — manual for v1; Playwright e2e tests for v2
- **Fuzzing** for path sanitization (Go 1.18+ native fuzzing)

---

## 9. Phased Delivery

| Phase | Scope | Milestone |
|-------|-------|-----------|
| **Phase 1** | CLI skeleton + Docker client + list/read API + basic tree UI | Can browse a container's files in browser |
| **Phase 2** | File viewing with syntax highlighting + CodeMirror editor + save | Can view and edit files |
| **Phase 3** | Upload, delete, download operations + context menus | Full CRUD working |
| **Phase 4** | Search, dark/light theme, error handling polish, status bar | Feature complete |
| **Phase 5** | Tests, Makefile, Dockerfile, CI/CD, release binaries | Production ready |

Each phase builds on the last and produces a working (if incomplete) tool. Phase 1 alone is already useful for container debugging.
