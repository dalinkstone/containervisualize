# CLAUDE.md

This file provides context and rules for Claude Code when working on this project.

## Project Overview

Container Visualize is a single-binary Go tool that connects to a running Docker container and serves a web-based file explorer. Users can browse, view, edit, upload, download, and delete files inside any container from their browser. The frontend is vanilla JS embedded at compile time — no Node.js, no build step.

**Repo:** https://github.com/dalinkstone/containervisualize

## Tech Stack

- **Language:** Go 1.22+ (use stdlib where possible)
- **HTTP routing:** Go 1.22 `net/http` ServeMux (method + pattern matching) — no third-party routers
- **Docker SDK:** `github.com/docker/docker/client` — this is the only heavy dependency
- **Frontend:** Vanilla JavaScript, no frameworks. CodeMirror 5 loaded from CDN for editing.
- **Embedding:** `go:embed` for all static assets in `web/static/`
- **Logging:** `log/slog` (stdlib structured logging)

## Project Structure

```
cmd/containervisualize/main.go     → Entry point, CLI flags, server startup
internal/docker/client.go          → Docker SDK client wrapper
internal/docker/filesystem.go      → File operations (list, read, write, delete, archive)
internal/docker/container.go       → Container metadata queries
internal/api/router.go             → HTTP route registration
internal/api/handlers.go           → Request handlers
internal/api/middleware.go         → Logging, readonly enforcement, path validation
internal/api/responses.go          → JSON response helpers
internal/model/types.go            → Shared types (FileNode, ContainerInfo, APIError)
web/embed.go                       → go:embed directives
web/static/index.html              → Single-page app shell
web/static/css/style.css           → All styles (dark/light theme via CSS custom properties)
web/static/js/api.js               → Fetch wrapper for backend API
web/static/js/tree.js              → File tree component
web/static/js/editor.js            → CodeMirror wrapper and file viewer
web/static/js/toolbar.js           → Upload, download, search controls
web/static/js/app.js               → App init and state management
```

## Key Architecture Rules

### Go Backend

- **Never use `os/exec` to run Docker commands.** Always use the Docker SDK (`github.com/docker/docker/client`). The only exec usage is `ContainerExecCreate`/`ExecAttach` for running commands *inside* containers.
- **Never construct shell command strings.** All exec commands use `[]string` args that map to `execve`. Always include `"--"` before user-derived path arguments to prevent flag injection.
- **All file paths must be validated** before reaching Docker operations. Use the `ValidatePath()` helper which calls `filepath.Clean`, rejects `..` components, requires absolute paths, and strips null bytes. This validation happens in middleware, not in individual handlers.
- **Stream, don't buffer.** File reads pipe directly from Docker tar stream to HTTP response. Never read an entire file into memory. Use `io.Copy` and `io.ReadCloser` patterns.
- **Docker's copy API speaks tar.** `CopyFromContainer` returns tar. `CopyToContainer` accepts tar. Work with tar streams directly using `archive/tar` — don't extract to temp files.
- **Fallback for minimal containers.** `ListDir` first tries `ls` via exec. If that fails (no `ls` binary, as in `FROM scratch` images), fall back to `CopyFromContainer` and read tar headers only.
- **No third-party HTTP middleware or routers.** Use stdlib `net/http` and handwritten middleware functions with the `func(http.Handler) http.Handler` pattern.

### Frontend

- **Zero framework dependencies.** No React, Vue, Svelte, or any other framework. Vanilla JS with ES modules or simple script loading.
- **No build step.** Everything in `web/static/` must work as-is when served by the Go file server. No TypeScript, no JSX, no bundler.
- **CodeMirror 5 from CDN** (`cdnjs.cloudflare.com`). Not CodeMirror 6 (requires bundler). Fallback to `<textarea>` if CDN is unreachable.
- **CSS custom properties for theming.** Dark theme is default (Catppuccin Mocha palette). Light theme via `[data-theme="light"]` selector on `<html>`.
- **Event delegation** on the tree container. Don't attach click listeners to individual tree nodes.
- **Lazy loading.** Tree directories fetch children on expand, not upfront. Never scan the full filesystem.

### Security

- **Localhost by default.** Bind to `127.0.0.1`, not `0.0.0.0`. User must explicitly pass `--host 0.0.0.0` to expose externally.
- **`--readonly` flag** must block ALL mutation endpoints (PUT, POST, DELETE on `/api/*`) at the middleware level, not in individual handlers.
- **Never allow deleting `/`.** The delete handler must explicitly reject root path deletion before calling the Docker layer.
- **Upload size limits.** Use `http.MaxBytesReader` with a 50MB default on the upload handler.
- **No shell spawning.** Exec commands are fixed (`ls`, `rm`, `find`, `grep`). User input only appears as arguments, never as part of the command name or flags.

## Common Commands

```bash
# Build
make build                    # → bin/containervisualize

# Run in development
make dev CONTAINER=my-app     # runs with --verbose

# Run tests
make test                     # unit tests
make test-integration         # integration tests (requires Docker)

# Lint
make lint                     # requires golangci-lint

# Format
make fmt

# Cross-compile release binaries
make release                  # → bin/containervisualize-{os}-{arch}
```

## API Endpoints

```
GET    /api/container              → Container metadata
GET    /api/tree?path=/&depth=1    → List directory contents
GET    /api/file?path=...          → Read file contents
PUT    /api/file?path=...          → Update file (body = new content)
POST   /api/file?path=...          → Upload file (multipart form)
DELETE /api/file?path=...          → Delete file or directory
GET    /api/archive?path=...       → Download directory as .tar.gz
GET    /api/search?q=...&path=/    → Search filenames
GET    /                           → Serve embedded web UI
```

## Testing Conventions

- Unit tests go next to the file they test: `filesystem_test.go` alongside `filesystem.go`
- Integration tests use build tag `//go:build integration` and require Docker
- Integration tests use `testcontainers-go` to spin up real containers
- Table-driven tests for all validation and parsing logic
- Path validation and ls parsing must be fuzz-tested (`func FuzzValidatePath`)

## Code Style

- Run `gofmt -s` on all Go files
- Error messages are lowercase, no trailing punctuation: `return fmt.Errorf("container not found: %s", id)`
- Context (`context.Context`) is always the first parameter
- Exported functions have doc comments; unexported ones have comments only when behavior is non-obvious
- Frontend JS uses `const`/`let` (never `var`), template literals, and async/await (no raw `.then()` chains)

## Implementation Phases

The project is built in 5 phases (see PLAN.md for full prompts):

1. **Skeleton + Docker client + tree API + basic UI** — browsable file tree
2. **CodeMirror editor + syntax highlighting + save** — editable files
3. **Upload, delete, download + context menus** — full CRUD
4. **Search, theme toggle, keyboard shortcuts, polish** — feature complete
5. **Tests, Makefile, CI/CD, Dockerfile, release** — production ready

Each phase produces a working tool. Don't skip ahead — complete and verify each phase before moving on.

## Current Progress

**Phase 1.1: Project initialization and Docker client — COMPLETE**

Implemented:
- CLI entry point with all flags (--container, --port, --host, --readonly, --depth, --docker-host, --no-open, --verbose)
- Docker client wrapper (NewDockerClient, Ping, Close)
- Container info (GetContainerInfo via ContainerInspect)
- Filesystem operations: ValidatePath, ListDir (exec + tar fallback), StatPath, ReadFile, WriteFile
- ls output parser with demux for Docker exec stream framing
- API layer stubs: router, handlers (GET /api/container, /api/tree, /api/file working; PUT/POST/DELETE return 501), middleware (logging, readonly, path validation), JSON response helpers
- Web embed with placeholder index.html
- Makefile with build, dev, test, lint, fmt, clean, release targets
- Graceful shutdown on SIGINT/SIGTERM

**Phase 1.2: API layer wiring and full route registration — COMPLETE**

Implemented:
- Response helpers: WriteJSON, WriteError, StreamContent (sets Content-Type, Content-Disposition, Content-Length headers and streams reader to response)
- Middleware: LoggingMiddleware (logs method, path, status, duration), ReadOnlyMiddleware (rejects PUT/POST/DELETE on /api/* when readonly), PathValidationMiddleware (validates and cleans "path" query param via ValidatePath)
- Router: NewRouter wiring DockerClient, containerID, readonly flag, and embedded FS. All routes registered with Go 1.22 ServeMux method+pattern matching
- Full route registration:
  - GET /api/container → returns container metadata JSON
  - GET /api/tree → lists directory contents (path validated)
  - GET /api/file → reads file with content type detection (512-byte sniff + MultiReader re-prepend) and streaming via StreamContent
  - PUT /api/file → 501 placeholder
  - POST /api/file → 501 placeholder
  - DELETE /api/file → 501 placeholder
  - GET /api/archive → 501 placeholder
  - GET /api/search → 501 placeholder
  - GET / → serves embedded static files
- PathValidation middleware applied to /api/tree, /api/file, /api/archive, /api/search
- ReadOnly middleware wraps all /api/* routes
- Logging middleware wraps everything
- handleGetFile: detects content type via http.DetectContentType on first 512 bytes, uses io.MultiReader to re-prepend buffer, streams via StreamContent with Content-Disposition header
- main.go wires DockerClient → NewRouter → http.Server with graceful shutdown

**Phase 1.3: Basic file tree UI (frontend) — COMPLETE**

Implemented:
- `web/static/index.html`: SPA shell with header (app name + container badge + refresh button), main area (resizable sidebar + content pane), status bar. Loads CodeMirror 5 from CDN (codemirror.min.js + language modes: javascript, xml, htmlmixed, css, markdown, python, go, yaml, shell, dockerfile). Loads app CSS and JS files in order.
- `web/static/css/style.css`: Catppuccin Mocha dark theme via CSS custom properties (--bg-primary, --bg-secondary, --bg-surface, --text-primary, --text-secondary, --accent, --border, etc.). Light theme support via `[data-theme="light"]`. Layout: fixed header, flex main with sidebar + content, fixed status bar. Tree styles with indentation, hover/selected states, expand/collapse arrows. Editor area with breadcrumb, pre/code display, image preview, binary notice. Custom scrollbars (webkit + Firefox). Responsive: sidebar becomes slide-out panel on narrow screens (<768px). Resizable sidebar via drag handle.
- `web/static/js/api.js`: API module with methods: getContainer(), getTree(path), getFile(path), updateFile(path, content), uploadFile(dirPath, file), deleteFile(path). All return promises. Non-2xx throws with error message from JSON body. getFile returns text for text-like content types, blob otherwise.
- `web/static/js/tree.js`: FileTree class with event delegation on container. loadRoot() fetches /api/tree?path=/ and renders entries. renderNode creates tree items with arrow (directories), icon (folder/file/link), name, size, symlink target. Directories expand/collapse on click (lazy-loads children). Tracks expanded state — re-click collapses without refetch. Highlights selected file. refresh() reloads tree preserving expanded state. Uses CustomEvent 'file-select' for file selection.
- `web/static/js/editor.js`: EditorPanel class. openFile(path, content, contentType) shows: text in pre/code block, images via object URL, binary with size and download link. Breadcrumb shows file path. clear() resets to empty state.
- `web/static/js/toolbar.js`: Toolbar class. setContainerInfo(info) updates badge with name, image, running status indicator. onRefresh(callback) binds refresh button.
- `web/static/js/app.js`: On DOMContentLoaded: creates FileTree, EditorPanel, Toolbar instances. Fetches container info, loads root tree, wires file-select event to editor, wires refresh button to tree.refresh(). Implements sidebar resize via drag handle with min/max width constraints.

**Next: Phase 2** — CodeMirror editor integration, syntax highlighting, file save

### Manual Testing

Prerequisites: Docker running, at least one container running (e.g., `docker run -d --name test-nginx nginx`).

```bash
# 1. Build the binary
make build

# 2. Run against a container
./bin/containervisualize -c test-nginx --no-open -v

# 3. Open http://localhost:8080 in a browser
#    - You should see the Container Visualize UI with a dark theme
#    - The header shows "Container Visualize" and a container badge (name, image, green dot if running)
#    - The left sidebar shows the file tree starting at /
#    - Click a directory to expand it (lazy-loads children from the API)
#    - Click a file to view its text content in the right pane
#    - Click the refresh button (↻) in the header to reload the tree
#    - The sidebar is resizable by dragging the border between sidebar and content

# 4. Test the API endpoints directly:
curl http://localhost:8080/api/container          # Container metadata JSON
curl http://localhost:8080/api/tree?path=/         # Directory listing JSON array
curl "http://localhost:8080/api/file?path=/etc/hostname"  # File contents with detected Content-Type

# 5. Test readonly mode:
./bin/containervisualize -c test-nginx --no-open --readonly -v
# Then:
curl -X PUT http://localhost:8080/api/file?path=/tmp/test     # Should return 403 Forbidden
curl -X DELETE http://localhost:8080/api/file?path=/tmp/test   # Should return 403 Forbidden

# 6. Test path validation:
curl "http://localhost:8080/api/tree?path=../../../etc"  # Should return 400 Bad Request

# 7. Stop the server with Ctrl+C (graceful shutdown)
```

## Things to Avoid

- Don't add a `pkg/` or `util/` directory. If something needs to be shared, put it in `internal/model/`.
- Don't add third-party dependencies for things the stdlib handles (HTTP routing, JSON encoding, tar, gzip, logging, testing).
- Don't create React/Vue/Svelte components. This is vanilla JS.
- Don't use `docker exec` via `os/exec`. Use the Docker SDK's `ContainerExecCreate` and `ExecAttach`.
- Don't buffer entire files in memory for read/write operations. Stream everything.
- Don't add WebSocket support in v1. Manual refresh is fine for now.
- Don't create separate CSS/JS files per component beyond the existing 5 JS files and 1 CSS file.
- Don't add authentication in v1. Localhost binding is the security model.
