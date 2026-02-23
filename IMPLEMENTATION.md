# Implementation Plan — Container Visualize

This document describes the engineering design, architecture decisions, and implementation details for Container Visualize.

---

## 1. Design Principles

Three principles govern every decision:

**Security first.** The tool interacts with Docker containers, which means it touches real filesystems. Every API endpoint validates and sanitizes paths. Localhost binding is the default. Read-only mode exists for when you just want to look. No shell spawning — we use Docker SDK exec with fixed commands and `[]string` args exclusively.

**Single binary simplicity.** One `go build`, one binary, zero runtime dependencies. The web frontend is embedded at compile time using Go's `embed` package. No Node.js build step, no sidecar process, no config files required. Run it and go.

**Lazy efficiency.** Don't scan the entire container filesystem upfront. Load directory contents on-demand as the user expands tree nodes. Stream file contents rather than buffering entire files into memory. Use tar archives (Docker's native copy format) directly instead of converting between formats unnecessarily.

---

## 2. Project Structure

```
containervisualize/
├── cmd/
│   └── containervisualize/
│       └── main.go                          # Entry point, CLI flags (incl. --version), server startup
├── internal/
│   ├── docker/
│   │   ├── client.go                        # Docker SDK client wrapper (Ping, CopyToContainer, Close)
│   │   ├── container.go                     # Container info via ContainerInspect
│   │   ├── filesystem.go                    # File ops (ListDir, ReadFile, WriteFile, DeletePath,
│   │   │                                    #   ArchiveDir, SearchFiles, StatPath, ValidatePath)
│   │   ├── filesystem_test.go               # Unit tests (ValidatePath, parseLsLine, sanitizeSearchQuery,
│   │   │                                    #   sortNodes, demuxExecOutput, parseLsOutput, FuzzValidatePath)
│   │   └── filesystem_integration_test.go   # Integration tests with testcontainers-go
│   ├── api/
│   │   ├── router.go                        # HTTP route registration (Go 1.22 ServeMux patterns)
│   │   ├── handlers.go                      # Request handlers for all 8 API endpoints
│   │   ├── middleware.go                    # LoggingMiddleware, ReadOnlyMiddleware, PathValidationMiddleware
│   │   ├── middleware_test.go               # Middleware unit tests
│   │   └── responses.go                     # WriteJSON, WriteError, StreamContent helpers
│   └── model/
│       └── types.go                         # FileNode, ContainerInfo, APIError structs
├── web/
│   ├── embed.go                             # go:embed all:static
│   └── static/
│       ├── index.html                       # SPA shell (loads CodeMirror 5 from CDN, all JS/CSS)
│       ├── css/
│       │   └── style.css                    # All styles — Catppuccin Mocha dark + light theme,
│       │                                    #   file tree, editor, context menus, search, status bar,
│       │                                    #   toasts, confirmation dialogs, connection overlay,
│       │                                    #   loading spinners, responsive layout
│       └── js/
│           ├── api.js                       # Fetch wrapper (getContainer, getTree, getFile, updateFile,
│           │                                #   uploadFile, deleteFile, downloadArchive, downloadFile, search)
│           ├── app.js                       # App init, keyboard shortcuts, toast/confirm system,
│           │                                #   status bar, connection health polling, upload progress
│           ├── codemirror-loader.js          # Dynamic CDN loader for CodeMirror 5
│           ├── editor.js                    # CodeMirror wrapper — mode detection, save, dirty state,
│           │                                #   markdown preview, theme sync, loading spinner
│           ├── toolbar.js                   # Search (debounced, dropdown, keyboard nav), theme toggle
│           │                                #   (localStorage), upload/download button wiring
│           └── tree.js                      # File tree — lazy expand, context menus, drag-and-drop,
│                                            #   navigateToFile, right-click CRUD, event delegation
├── .github/
│   └── workflows/
│       ├── ci.yml                           # CI: test + build, lint, integration (Go 1.24)
│       └── release.yml                      # Release binaries on tag push (v*)
├── Dockerfile                               # Multi-stage: golang:1.24-alpine → alpine:3.19
├── Makefile                                 # build, test, test-integration, lint, fmt, dev, docker, release
├── go.mod                                   # Go 1.24, Docker SDK, testcontainers-go
├── go.sum
├── README.md                                # User-facing docs
├── IMPLEMENTATION.md                        # This file — architecture and design
├── PLAN.md                                  # Build execution plan (phase prompts)
└── CLAUDE.md                                # Claude Code instructions and project rules
```

This is flat where it can be and nested where it needs to be. No `pkg/` directory, no `util/` grab bag. Every directory has a clear reason to exist.

---

## 3. Backend Design

### 3.1 Docker Client Layer (`internal/docker/`)

The Docker client layer wraps the official `github.com/docker/docker/client` SDK. It exposes methods that the API handlers consume.

**DockerClient struct and methods:**

```go
// client.go
type DockerClient struct { cli *client.Client }

func NewDockerClient(dockerHost string) (*DockerClient, error)
func (d *DockerClient) Ping(ctx context.Context) error
func (d *DockerClient) CopyToContainer(ctx, containerID, destPath string, content io.Reader) error
func (d *DockerClient) Close() error

// container.go
func (d *DockerClient) GetContainerInfo(ctx, containerID string) (*ContainerInfo, error)

// filesystem.go
func ValidatePath(path string) (string, error)
func (d *DockerClient) ListDir(ctx, containerID, path string) ([]FileNode, error)
func (d *DockerClient) ReadFile(ctx, containerID, path string) (io.ReadCloser, int64, error)
func (d *DockerClient) WriteFile(ctx, containerID, path string, content io.Reader, size int64) error
func (d *DockerClient) DeletePath(ctx, containerID, path string) error
func (d *DockerClient) StatPath(ctx, containerID, path string) (*FileNode, error)
func (d *DockerClient) ArchiveDir(ctx, containerID, path string) (io.ReadCloser, error)
func (d *DockerClient) SearchFiles(ctx, containerID, rootPath, query string, searchContent bool) ([]FileNode, error)
```

**Implementation details:**

- **ListDir** uses `ContainerExecCreate` + `ExecAttach` to run `ls -la --time-style=full-iso -- <path>` inside the container. The output is demuxed from Docker's multiplexed exec stream (`demuxExecOutput`) and parsed line-by-line via a regex (`parseLsLine`). Results are sorted (directories first, then alphabetically via `sortNodes`).

  *Fallback:* If exec fails (e.g., container has no `ls` binary — think `FROM scratch`), fall back to `CopyFromContainer` on the directory path and read tar headers only (discard file contents). This handles minimal containers gracefully.

- **ReadFile** uses `CopyFromContainer`, which returns a tar stream. We extract the single file entry from the tar and return a `tarFileReader` (wraps `tar.Reader` as `io.ReadCloser`, closing the underlying stream when done). No buffering the whole file into memory.

- **WriteFile** creates a tar archive in a `bytes.Buffer` containing a single file (name = basename, mode 0644), then uses `CopyToContainer` with the destination set to the parent directory. Docker's copy API is tar-native.

- **DeletePath** uses `ContainerExecCreate` to run `rm -rf -- <path>`. Validates path is not `/` before executing. Reads all output and checks exit code.

- **SearchFiles** uses exec to run either `find` (filename search) or `grep -rl` (content search) with a 10-second timeout (`context.WithTimeout`). Query is sanitized via `sanitizeSearchQuery` which strips all shell-special characters. Results limited to 100 matches.

- **ArchiveDir** uses `CopyFromContainer` directly, returning the raw tar stream for the handler to gzip-wrap.

### 3.2 API Layer (`internal/api/`)

Standard REST over HTTP using Go's `net/http` with the 1.22 routing enhancements (method + pattern matching).

**Endpoints:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/container` | `handleGetContainer` | Container metadata (name, image, status, created) |
| `GET` | `/api/tree?path=/` | `handleGetTree` | List directory contents at path |
| `GET` | `/api/file?path=...` | `handleGetFile` | Read file (content-type detected via 512-byte sniff) |
| `PUT` | `/api/file?path=...` | `handleUpdateFile` | Update file contents (body = new content) |
| `POST` | `/api/file?path=...` | `handleUploadFile` | Upload file(s) to directory (multipart, 50MB limit) |
| `DELETE` | `/api/file?path=...` | `handleDeleteFile` | Delete file or directory (rejects `/`) |
| `GET` | `/api/archive?path=...` | `handleGetArchive` | Download file or directory as .tar.gz |
| `GET` | `/api/search?q=...&path=/` | `handleSearch` | Search filenames or contents (`content:` prefix) |
| `GET` | `/` | static file server | Serve the embedded web UI |

**Why no WebSocket for file watching?**
Docker doesn't provide filesystem event streams natively — we'd have to poll via exec or use inotifywait inside the container (which may not exist). For v1, the tree refreshes on user action. A manual "Refresh" button handles staleness. WebSocket watching can be a v2 feature.

### 3.3 Middleware

Three middleware functions, applied via `func(http.Handler) http.Handler` pattern:

1. **LoggingMiddleware** — Wraps `http.ResponseWriter` to capture status code. Logs method, path, status, and duration for every request using `slog`.

2. **ReadOnlyMiddleware(readonly bool)** — Returns middleware that rejects `PUT`, `POST`, or `DELETE` to `/api/*` with 403 Forbidden when readonly is true. Applied globally.

3. **PathValidationMiddleware** — For any request with a `path` query parameter:
   - Calls `ValidatePath()` which runs `filepath.Clean()`, rejects `..` components after cleaning, requires absolute paths, and rejects null bytes
   - Sets the cleaned path back on the URL query
   - Returns 400 if validation fails

   Applied selectively to routes that accept a `path` parameter (`/api/tree`, `/api/file`, `/api/archive`, `/api/search`).

**Middleware chain order:** LoggingMiddleware (outermost) → ReadOnlyMiddleware → PathValidationMiddleware (per-route) → Handler.

### 3.4 Response Helpers

- **WriteJSON(w, status, data)** — Sets `Content-Type: application/json`, marshals with `json.NewEncoder`
- **WriteError(w, status, message, path)** — Writes structured `APIError` JSON: `{error, path, status}`
- **StreamContent(w, reader, filename, contentType, size)** — Sets Content-Type, Content-Disposition, Content-Length headers and streams via `io.Copy`. Closes reader when done.

### 3.5 Error Handling

All errors map to structured JSON responses:

```json
{
  "error": "file not found",
  "path": "/etc/missing.conf",
  "status": 404
}
```

---

## 4. Frontend Design

### 4.1 Philosophy

The frontend is vanilla JavaScript. No React, no Vue, no build step. The reasons:

- It embeds cleanly with `go:embed` — no `node_modules`, no webpack output
- The UI is fundamentally simple: a tree on the left, a viewer/editor on the right, a toolbar on top
- CodeMirror 5 (loaded from CDN with a `<textarea>` fallback) handles the heavy lifting for the editor
- Total JS payload target: under 50KB gzipped (excluding CodeMirror)

### 4.2 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Container Visualize  [Search files... (Ctrl+P)]  [☾] [↟] [↡] [↻] [nginx:latest ●] │
├──────────────────────┬──────────────────────────────────────────┤
│  📁 /                │                                          │
│  ├── 📁 etc/         │   /etc/nginx/nginx.conf          [Save] │
│  │   ├── 📁 nginx/   │   ─────────────────────────────         │
│  │   │   ├── 📄 ng…  │   worker_processes  1;                  │
│  │   │   └── 📁 co…  │   events {                              │
│  │   ├── 📄 hosts    │       worker_connections 1024;           │
│  │   └── 📄 passwd   │   }                                     │
│  ├── 📁 var/         │   http {                                │
│  │   └── 📁 log/     │       ...                               │
│  └── 📁 usr/         │                                          │
├──────────────────────┴──────────────────────────────────────────┤
│  ● Connected          │ /etc/nginx/nginx.conf · 2.4 KB · 85 lines · UTF-8 │ nginx ● │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 File Tree Component (`tree.js`)

The tree loads lazily. On initial page load, it fetches `GET /api/tree?path=/` to get root-level entries. When the user clicks to expand a directory, it fetches that directory's children on demand. A spinner is shown during loading.

**State model:**

```javascript
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
- Click directory → toggle expand/collapse, fetch children if not loaded (with spinner)
- Right-click → context menu:
  - Files: Download, Delete, Copy Path
  - Directories: New File, Upload File Here, Download as Archive, Delete, Copy Path
- Drag-and-drop files onto a directory → upload to that directory
- `navigateToFile(path)` → expands parent directories one by one, selects and scrolls to target (used by search)

Uses event delegation on the tree container — no per-node click listeners.

### 4.4 Editor Component (`editor.js`)

For text files, we use CodeMirror 5 loaded from CDN (`cdnjs.cloudflare.com`). If the CDN is unreachable (offline/air-gapped use), fall back to a plain `<textarea>` with monospace font.

**CodeMirror configuration:** material-darker theme (dark) / default theme (light), line numbers, bracket matching, auto-close brackets, fold gutter, active line highlight, tabSize 2. Theme switches dynamically when the user toggles dark/light mode.

**File type handling:**
- Text/code files: Open in CodeMirror with mode detected from file extension:
  - `.js/.jsx/.ts/.tsx` → javascript, `.py` → python, `.go` → go, `.html/.htm` → htmlmixed, `.css/.scss` → css, `.md` → markdown, `.yml/.yaml` → yaml, `.sh/.bash/.zsh` → shell, `.json` → javascript+json, `.xml` → xml, `.sql` → sql, `.rb` → ruby, `.php` → php, `.rs` → rust, `.c/.h` → text/x-csrc, `.java` → text/x-java, `Dockerfile` → dockerfile, `.toml` → toml
- Images (png, jpg, gif, svg, webp): Render inline via object URL
- Binary files: Show "Binary file (X bytes)" with download link
- Markdown: Toggle between Edit and Preview modes. Preview uses a simple regex-based renderer for headers, bold, italic, code blocks, lists, links, paragraphs, horizontal rules.

**Save flow:** User edits → clicks Save or Ctrl+S → `PUT /api/file?path=...` → success toast → dirty indicator clears.

**Dirty state:** Tracked via CodeMirror change events. Blue dot indicator on the filename. Unsaved changes prompt before switching files.

**Loading state:** Shows breadcrumb + centered spinner while file content loads from the backend.

### 4.5 Toolbar Component (`toolbar.js`)

- **Search:** Input field with 300ms debounce. Backend search triggered for queries >= 3 chars. Results rendered in dropdown with filename + path, match highlighting. Arrow keys + Enter for keyboard navigation. Escape to dismiss. Click outside to dismiss.
- **Theme toggle:** Sun/moon icon button. Toggles `data-theme` attribute on `<html>`. Persists preference in `localStorage` (`cv-theme`). Dispatches `theme-change` CustomEvent for CodeMirror theme sync.
- **Upload button (↟):** Opens file picker, uploads to selected directory.
- **Download button (↡):** Downloads currently open file or selected tree node.
- **Refresh button (↻):** Reloads the currently expanded tree state.
- **Container badge:** Shows container name, image, and running status indicator (green/red dot).

### 4.6 App Init and State (`app.js`)

- **Toast notification system:** `window.showToast(message, type)` — types: success (green), error (red), info (blue). Auto-dismiss 3s. Slide-in animation. Positioned bottom-right.
- **Confirmation dialog:** `window.showConfirm(message, onConfirm, actionLabel)` — modal overlay, Cancel/Action buttons, Escape/click-outside to dismiss.
- **Status bar:** Three sections — left (connection status with green/red dot), center (file path · size · line count · UTF-8), right (container name + status dot).
- **Connection health monitoring:** Polls `GET /api/container` every 5 seconds. On failure, shows full-screen "Connection to Docker lost" overlay with spinner. On recovery, hides overlay, shows "Connection restored" toast. Detects container stopped state, shows red banner with Reconnect button.
- **Keyboard shortcuts:** Ctrl/Cmd+S (save), Ctrl/Cmd+P (search), Ctrl/Cmd+Shift+E (focus tree), Escape (dismiss menus/dialogs), Delete/Backspace (delete selected, with confirmation), F2 (rename placeholder).
- **Upload progress:** Shows spinner overlay on sidebar during upload.

### 4.7 Styling (`style.css`)

Dark theme by default (Catppuccin Mocha palette). Light theme via `[data-theme="light"]` selector.

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

Key CSS features:
- Fixed header, flex main (sidebar + content), fixed status bar
- Resizable sidebar via drag handle (min/max width constraints)
- File tree: indentation, hover/selected states, expand/collapse arrows, spinners during load
- Context menu: fixed position, dark surface, rounded corners, hover highlight, danger items
- Confirmation dialog: modal overlay, centered dialog, action buttons
- Search: dropdown with shadow, match highlighting, keyboard navigation states
- Loading spinners: 12px circles (tree), 40px circles (connection overlay), centered editor spinner
- Drag-and-drop: dashed outline on tree, highlight on drop target
- Custom scrollbars (webkit + Firefox)
- Responsive: sidebar becomes slide-out panel on screens < 768px, status center hidden on mobile

---

## 5. Build and Distribution

### 5.1 Build Process

The Makefile handles all build operations:

```makefile
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY := containervisualize
LDFLAGS := -s -w -X main.version=$(VERSION)

build:
    CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY) ./cmd/containervisualize

release:
    GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-amd64 ./cmd/containervisualize
    GOOS=linux   GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-arm64 ./cmd/containervisualize
    GOOS=darwin  GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-darwin-arm64 ./cmd/containervisualize
    GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-darwin-amd64 ./cmd/containervisualize
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-windows-amd64.exe ./cmd/containervisualize

docker:
    docker build -t $(BINARY) --build-arg VERSION=$(VERSION) .
```

Since the frontend is vanilla JS with no build step, `go build` is literally the only build command. The `web/static/` directory is embedded at compile time via `//go:embed all:static` in `web/embed.go`.

The `--version` flag prints the version (injected via `-X main.version=...` ldflags) and exits:

```go
var version = "dev"  // overridden by linker

if *versionFlag {
    fmt.Printf("containervisualize %s\n", version)
    os.Exit(0)
}
```

### 5.2 Docker Image

Multi-stage build to produce a minimal image:

```dockerfile
FROM golang:1.24-alpine AS builder
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION}" -o /containervisualize ./cmd/containervisualize

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /containervisualize /usr/local/bin/containervisualize
ENTRYPOINT ["containervisualize"]
```

Usage: mount the Docker socket so the tool can inspect other containers, and bind to `0.0.0.0` since the tool runs inside a container:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 9500:9500 \
  containervisualize --container my-app --host 0.0.0.0
```

### 5.3 CI/CD

Two GitHub Actions workflows:

**CI (`.github/workflows/ci.yml`)** — Triggers on push and pull_request to master:
- `test` job: `make test` + `make build` + verify `--version` flag
- `lint` job: `golangci-lint-action@v6`
- `integration` job: `make test-integration` (Docker is available in ubuntu-latest runners)

**Release (`.github/workflows/release.yml`)** — Triggers on tag push (`v*`):
- Builds cross-platform binaries via `make release`
- Creates GitHub Release with all binaries using `softprops/action-gh-release@v2`

---

## 6. Security Model

### 6.1 Attack Surface Analysis

The primary risk is that this tool provides browser-based write access to a container's filesystem. Mitigations:

| Risk | Mitigation |
|------|-----------|
| Path traversal (`../../etc/shadow`) | `filepath.Clean` + reject `..` after cleaning + absolute path enforcement + null byte rejection |
| Unauthorized network access | Bind to `127.0.0.1` by default — user must explicitly pass `--host 0.0.0.0` |
| Accidental production use | `--readonly` flag blocks PUT/POST/DELETE at middleware level |
| Large file upload DoS | 50MB limit via `http.MaxBytesReader` on upload handler |
| Container escape | Docker SDK copy/exec only — no mount, no privileged operations |
| Exec injection | Commands are fixed (`ls`, `rm`, `find`, `grep`). User input is only passed as arguments, never as command names. `[]string` args map directly to `execve`, never through a shell |
| Flag injection | `--` separator before all user-derived path arguments |
| Root deletion | Explicitly rejected in both handler and Docker layer |

### 6.2 Exec Safety

All exec commands use `[]string` args that map directly to `execve`. The `--` separator prevents flag injection:

```go
// Delete
Cmd: []string{"rm", "-rf", "--", sanitizedPath}

// List directory
Cmd: []string{"ls", "-la", "--time-style=full-iso", "--", sanitizedPath}

// Search filenames
Cmd: []string{"find", rootPath, "-maxdepth", "10", "-name", "*" + query + "*", "-type", "f"}

// Search contents
Cmd: []string{"grep", "-rl", "--include=*", "--", query, rootPath}
```

The search query is additionally sanitized via `sanitizeSearchQuery()` which strips all characters except alphanumeric, `.`, `-`, `_`, space, and `/`.

### 6.3 Future Considerations (v2+)

- Optional token-based authentication for non-localhost deployments
- TLS support via `--tls-cert` and `--tls-key` flags
- Audit logging of all write operations
- Per-path access control lists

---

## 7. Performance Considerations

- **Lazy tree loading** prevents scanning containers with millions of files
- **Streaming reads** — file contents pipe from Docker tar stream → HTTP response via `io.Copy`. No intermediate buffer for the full file.
- **Tar reuse** — Docker's copy API speaks tar natively. We work with tar streams directly rather than extracting to temp files.
- **Connection reuse** — Single Docker client instance with persistent connection to the daemon.
- **Debounced search** — 300ms client-side debounce prevents flooding the backend. 10-second server-side timeout prevents runaway searches.

---

## 8. Testing Strategy

### 8.1 Unit Tests

**`internal/docker/filesystem_test.go`** — 37 test cases:
- `TestValidatePath` — 13 table-driven cases covering valid paths, relative paths, dotdot traversal, null bytes, empty strings
- `TestParseLsLine` — 8 cases: regular file, directory, symlink, spaces in name, very large file, root dir path, unparseable/empty lines
- `TestSanitizeSearchQuery` — 13 cases: normal input, shell special characters (`;`, backtick, `$`, `|`, `&`, parens), empty string
- `TestSortNodes` — directories first, alphabetical within groups
- `TestSortNodes_CaseInsensitive` — case-insensitive ordering
- `TestDemuxExecOutput` — 4 cases: Docker multiplexed stream, stderr ignored, non-multiplexed fallback, empty input
- `TestParseLsOutput` — skips dot entries and total line
- `FuzzValidatePath` — 8 seed values, validates absolute result, no null bytes, idempotency

**`internal/api/middleware_test.go`** — 19 test cases:
- `TestPathValidationMiddleware` — 7 cases: valid cleaned, trailing slash, root, relative rejected, dotdot cleaned, missing param, empty value
- `TestReadOnlyMiddleware` — 9 cases: PUT/POST/DELETE blocked in readonly, GET passes, all pass when not readonly, non-API passes
- `TestLoggingMiddleware` — response passthrough verification
- `TestLoggingMiddleware_CapturesStatusCode` — non-200 status capture

### 8.2 Integration Tests

**`internal/docker/filesystem_integration_test.go`** — Build tag: `//go:build integration`

Uses `testcontainers-go` to spin up an `nginx:alpine` container in `TestMain`:
- `TestListDir_Root` — verifies etc, var, usr in root listing
- `TestListDir_Nested` — verifies nginx.conf in `/etc/nginx`
- `TestReadFile` — reads nginx.conf, checks for "worker_processes"
- `TestWriteFile` — writes test content, reads back, verifies match
- `TestDeletePath` — writes → verifies exists → deletes → verifies gone
- `TestSearchFiles` — searches for "nginx.conf" in `/etc`
- `TestDeletePath_RootRejected` — verifies root deletion fails

### 8.3 Fuzzing

`FuzzValidatePath` uses Go's native fuzz testing with 8 seed values. The fuzz function validates:
- Result is always an absolute path (starts with `/`)
- No null bytes in output
- Function is idempotent (calling it twice produces the same result)

### 8.4 Frontend Tests

Manual testing for v1 — see CLAUDE.md for the full 20-step manual testing guide.

---

## 9. Phased Delivery

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | CLI skeleton + Docker client + list/read API + basic tree UI | **Complete** |
| **Phase 2** | CodeMirror editor + syntax highlighting + save | **Complete** |
| **Phase 3** | Upload, delete, download operations + context menus | **Complete** |
| **Phase 4** | Search, dark/light theme, keyboard shortcuts, polish | **Complete** |
| **Phase 5** | Tests, Makefile, CI/CD, Dockerfile, release | **Complete** |

Each phase built on the last and produced a working tool. Phase 1 alone was useful for container debugging. All 5 phases are now complete — the project is production-ready.
