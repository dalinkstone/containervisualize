# CLAUDE.md

This file provides context and rules for Claude Code when working on this project.

## Project Overview

Container Visualize is a single-binary Go tool that connects to a running Docker container and serves a web-based file explorer. Users can browse, view, edit, upload, download, and delete files inside any container from their browser. The frontend is vanilla JS embedded at compile time — no Node.js, no build step.

**Repo:** https://github.com/dalinkstone/containervisualize

## Tech Stack

- **Language:** Go 1.24+ (use stdlib where possible)
- **HTTP routing:** Go 1.22+ `net/http` ServeMux (method + pattern matching) — no third-party routers
- **Docker SDK:** `github.com/docker/docker/client` — this is the only heavy dependency
- **Frontend:** Vanilla JavaScript, no frameworks. CodeMirror 5 loaded from CDN for editing.
- **Embedding:** `go:embed` for all static assets in `web/static/`
- **Logging:** `log/slog` (stdlib structured logging)

## Project Structure

```
cmd/containervisualize/main.go                    → Entry point, CLI flags (incl. --version), server startup
internal/docker/client.go                         → Docker SDK client wrapper
internal/docker/filesystem.go                     → File operations (list, read, write, delete, archive, search)
internal/docker/filesystem_test.go                → Unit tests (ValidatePath, parseLsLine, sanitizeSearchQuery, sortNodes, demuxExecOutput, fuzz)
internal/docker/filesystem_integration_test.go    → Integration tests (testcontainers-go, //go:build integration)
internal/docker/container.go                      → Container metadata queries
internal/api/router.go                            → HTTP route registration
internal/api/handlers.go                          → Request handlers
internal/api/middleware.go                        → Logging, readonly enforcement, path validation
internal/api/middleware_test.go                   → Middleware unit tests
internal/api/responses.go                         → JSON response helpers
internal/model/types.go                           → Shared types (FileNode, ContainerInfo, APIError)
web/embed.go                                      → go:embed directives
web/static/index.html                             → Single-page app shell
web/static/css/style.css                          → All styles (dark/light theme via CSS custom properties)
web/static/js/api.js                              → Fetch wrapper for backend API
web/static/js/tree.js                             → File tree component with context menus
web/static/js/editor.js                           → CodeMirror wrapper and file viewer
web/static/js/toolbar.js                          → Search, theme toggle, upload/download controls
web/static/js/codemirror-loader.js                → Dynamic CDN loader for CodeMirror 5
web/static/js/app.js                              → App init, state management, keyboard shortcuts
Dockerfile                                        → Multi-stage build (golang:1.24-alpine → alpine:3.19)
Makefile                                          → Build, test, lint, release, docker targets
.github/workflows/ci.yml                          → CI: test, lint, integration on push/PR
.github/workflows/release.yml                     → Release binaries on tag push (v*)
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

# Build Docker image
make docker                   # → containervisualize:latest

# Cross-compile release binaries
make release                  # → bin/containervisualize-{os}-{arch}

# Check version
./bin/containervisualize --version
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
GET    /api/search?q=...&path=/    → Search filenames (prefix q with "content:" for content search)
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
  - PUT /api/file → updates file content (reads body, writes via WriteFile tar+CopyToContainer)
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

**Phase 2: CodeMirror editor integration, syntax highlighting, file save — COMPLETE**

Implemented:
- `web/static/index.html`: Added CodeMirror 5 CDN resources — material-darker theme CSS, foldgutter CSS, dialog CSS. Added language modes: clike, toml, sql, ruby, php, rust (in addition to existing modes). Added addons: active-line, matchbrackets, closebrackets, foldcode, foldgutter, brace-fold, comment-fold, search, searchcursor, dialog, jump-to-line.
- `web/static/js/editor.js`: Full rewrite. EditorPanel now creates CodeMirror instances for text files with: material-darker theme, line numbers, bracket matching, auto-close brackets, fold gutter, active line highlight, tabSize 2, readonly support. Mode detection from file extension (js/jsx/ts/tsx → javascript, py → python, go → go, html/htm → htmlmixed, css/scss → css, md → markdown, yml/yaml → yaml, sh/bash/zsh → shell, json → javascript+json, xml, sql, rb → ruby, php, rs → rust, c/h → text/x-csrc, java → text/x-java, Dockerfile → dockerfile, toml). Save button + Ctrl+S/Cmd+S keyboard shortcut. Dirty state tracking with dot indicator. Unsaved changes prompt before switching files. Markdown preview toggle (simple regex-based renderer for headers, bold, italic, code blocks, lists, links, paragraphs, horizontal rules). Fallback to textarea if CodeMirror CDN unreachable.
- `internal/api/handlers.go`: handleUpdateFile reads request body, calls docker.WriteFile to persist content. Returns JSON {status: "ok"} on success.
- `web/static/js/app.js`: Toast notification system (window.showToast) with success/error/info types, auto-dismiss 3s, slide-in animation. Global Ctrl+S/Cmd+S handler. EditorPanel now receives readonly flag from container info.
- `web/static/css/style.css`: Added styles for: editor toolbar (save button, md toggle), dirty indicator dot, CodeMirror container (full height), fallback textarea, markdown preview (headers, code, links, lists, hr), toast notifications (positioned bottom-right, colored by type, animated).

**Phase 3: Upload, delete, download + context menus — COMPLETE**

Implemented:
- `internal/docker/filesystem.go`: Added `DeletePath(ctx, containerID, path)` — validates path is not "/", executes `rm -rf --` via ContainerExecCreate/ExecAttach, checks exit code. Added `ArchiveDir(ctx, containerID, path)` — returns raw tar stream from CopyFromContainer for the handler to gzip.
- `internal/docker/client.go`: Added `CopyToContainer(ctx, containerID, destPath, content)` — wraps Docker SDK's CopyToContainer with AllowOverwriteDirWithFile option.
- `internal/api/handlers.go`:
  - `handleUploadFile`: Parses multipart form with 50MB limit (http.MaxBytesReader), iterates form files, creates tar archive per file, CopyToContainer to target directory, returns JSON with list of uploaded paths.
  - `handleDeleteFile`: Validates path is not "/", calls docker.DeletePath, returns success JSON.
  - `handleGetArchive`: Stats path first — if file, serves with Content-Disposition attachment; if directory, streams through gzip.NewWriter wrapping the tar stream from ArchiveDir, sets Content-Type application/gzip.
- `web/static/js/api.js`: Added `downloadArchive(path)` (opens /api/archive in new tab), `downloadFile(path)` (creates temporary anchor with download attribute). Updated `uploadFile` and `deleteFile` to return response JSON.
- `web/static/js/tree.js`: Full rewrite with context menu support. Right-click on tree nodes shows custom context menu: files get Download, Delete, Copy Path; directories get New File, Upload File Here, Download as Archive, Delete, Copy Path. "New File" prompts for filename, creates empty file via PUT. Context menu positioned within viewport bounds, dismissed on click outside or Escape. Added `removeNode(path)` to remove tree items after delete. Added `getSelectedDir()` for toolbar upload target. Added `_refreshDir(dirPath)` to reload a single directory's children. Added drag-and-drop: dragover highlights directory targets, drop uploads files to the hovered directory (or parent of hovered file).
- `web/static/js/toolbar.js`: Added `onUpload(callback)` and `onDownload(callback)` wiring for new header buttons.
- `web/static/js/app.js`: Added `window.showConfirm(message, onConfirm, actionLabel)` — modal overlay with dark surface, Cancel/Action buttons, Escape to dismiss, click-outside to dismiss. Wired `file-delete-request` event from tree context menu to show confirmation dialog before calling api.deleteFile. Wired upload button (opens file dialog, uploads to selected directory, refreshes tree). Wired download button (downloads currently open file or selected node). Readonly checks on upload and delete.
- `web/static/css/style.css`: Added styles for context menu (fixed position, dark surface, rounded corners, hover highlight, danger items, dividers), confirmation dialog (modal overlay, centered dialog, action buttons), drag-and-drop (dashed outline on tree, highlight on drop target).
- `web/static/index.html`: Added upload (↟) and download (↡) buttons to header-right.

**Phase 4: Search, theme toggle, keyboard shortcuts, polish — COMPLETE**

Implemented:
- `internal/docker/filesystem.go`:
  - Added `SearchFiles(ctx, containerID, rootPath, query, searchContent)` — searches filenames via `find -maxdepth 10 -name "*query*" -type f` or file contents via `grep -rl --include=* -- query path`. Uses `context.WithTimeout` for 10-second limit. Returns up to 100 results. Query sanitized via `sanitizeSearchQuery` (allows only alphanumeric, `.`, `-`, `_`, space, `/`).
  - Added `sanitizeSearchQuery(query)` — strips shell-special characters for safe exec args.
  - Added `demuxExecOutput(raw)` — extracts stdout from Docker's multiplexed exec stream. Refactored from inline code in `parseLsOutput` to shared helper.
- `internal/api/handlers.go`:
  - `handleSearch`: Parses `q` (required) and `path` (default `/`) query params. If `q` starts with `content:`, searches file contents; otherwise searches filenames. Calls `SearchFiles`, returns JSON array of `{name, path, type}`.
- `web/static/index.html`:
  - Added search input field in header-left with placeholder "Search files... (Ctrl+P)"
  - Added search results dropdown container below search input
  - Added theme toggle button (☾/☀) in header-right
  - Updated status bar with three sections: left (connection status with green/red dot), center (file info — path, size, line count, encoding), right (container name + status)
  - Added connection lost overlay (full-screen, spinner, "Connection to Docker lost. Retrying...")
  - Added container stopped banner (red bar at top with "Container has stopped" + Reconnect button)
  - Added `tabindex="0"` on file-tree for keyboard focus
- `web/static/css/style.css`:
  - Search styles: `.search-container` (relative positioned, max-width 360px), `.search-input` (mono font, surface bg, accent border on focus), `.search-results` (dropdown with shadow, max-height 360px, scrollable), `.search-result-item` (name + path, hover/highlighted states), `.search-match` (highlight span with accent background), `.search-result-hint` (centered message for empty/error states)
  - Status bar: Three-column flex layout with `.status-left`, `.status-center`, `.status-right`. Connection indicator with `.status-dot.connected` (green) and `.status-dot.disconnected` (red)
  - Loading states: `.spinner` (12px spinning circle with accent top border), `.editor-loading` (centered spinner + text), `.upload-overlay` (semi-transparent overlay on sidebar during upload)
  - Connection overlay: `.connection-overlay` (fixed full-screen dark backdrop), `.connection-spinner` (40px spinning circle), title and subtitle text
  - Container stopped banner: `.container-stopped-banner` (fixed red bar at top), `.banner-btn` (semi-transparent button)
  - Tree focus: `.file-tree:focus-visible` (accent outline)
  - Light theme toast colors adjusted for readability
  - Responsive: search container shrinks on narrow screens, status center hidden on mobile
- `web/static/js/api.js`:
  - Added `search(query, path)` — calls `GET /api/search?q=<query>&path=<path>`, returns JSON array
- `web/static/js/toolbar.js`: Full rewrite.
  - Theme toggle: Reads/writes `cv-theme` from `localStorage`. Toggles `data-theme` attribute on `<html>`. Dispatches `theme-change` CustomEvent for CodeMirror theme sync. Updates button icon (☾ for dark, ☀ for light).
  - Search: 300ms debounce on input. Backend search triggered for queries >= 3 chars. Results rendered in dropdown with name + path, match highlighting. Arrow keys + Enter for keyboard navigation. Escape to dismiss. Click outside to dismiss. `onSearchSelect(callback)` for result selection.
- `web/static/js/tree.js`:
  - Added spinner (`.spinner` CSS class) to tree loading indicator during directory expand
  - Added `navigateToFile(filePath)` — expands parent directories one by one, then selects and scrolls to the target file. Used by search result selection.
- `web/static/js/editor.js`:
  - Added `showLoading(path)` — shows breadcrumb + centered spinner while file loads
  - Added `getFileInfo()` — returns `{path, size, lines}` for status bar display
  - Tracks `_fileSize` and `_lineCount` from `openFile()`
  - `openFile` now accepts optional `size` parameter
  - CodeMirror theme switches between `material-darker` (dark) and `default` (light) based on current `data-theme`
  - Listens for `theme-change` event to update CodeMirror theme dynamically
- `web/static/js/app.js`: Major rewrite.
  - Status bar: `setConnectionStatus(bool)` updates green/red dot + text. `setFileInfo(info)` shows path · size · lines · UTF-8. `setContainerStatus(info)` shows container name + colored status dot.
  - Keyboard shortcuts:
    - `Ctrl/Cmd+S`: Save current file
    - `Ctrl/Cmd+P`: Focus search input
    - `Ctrl/Cmd+Shift+E`: Focus file tree
    - `Escape`: Dismiss context menu
    - `Delete/Backspace` (tree focused): Delete selected node with confirmation
    - `F2` (tree focused): Rename placeholder (shows "not yet supported" toast)
  - Connection health monitoring: Polls `GET /api/container` every 5 seconds. On failure, shows connection overlay with spinner. On recovery, hides overlay, shows "Connection restored" toast. Detects container stopped state, shows red banner with Reconnect button.
  - Upload progress: Shows spinner overlay on sidebar during upload
  - File loading: Shows spinner in editor while file content loads via `editor.showLoading()`
  - Search integration: `toolbar.onSearchSelect()` calls `tree.navigateToFile()` to expand parents and select the file
  - API errors shown as toast notifications

**Phase 5: Tests, Makefile, CI/CD, Dockerfile, release — COMPLETE**

Implemented:
- `cmd/containervisualize/main.go`: Added `var version = "dev"` at package level (overridden via `-X main.version=...` ldflags during build). Added `--version` flag that prints version and exits before any Docker operations.
- `internal/docker/filesystem_test.go`: Unit tests:
  - `TestValidatePath` — 13 table-driven cases: valid paths (root, nested, cleans dotdot, trailing slash, double slash), invalid paths (relative, dotdot at start, null byte, empty, bare dotdot, dot only)
  - `TestParseLsLine` — 8 cases: regular file, directory, symlink, file with spaces, very large file, root dir path, unparseable line, empty line
  - `TestSanitizeSearchQuery` — 13 cases: normal query, alphanumeric, spaces, dash/underscore, path separator, shell special chars (`;`, backtick, `$`, `|`, `&`, parens all stripped), all special chars, empty string
  - `TestSortNodes` — verifies directories first, alphabetical within groups
  - `TestSortNodes_CaseInsensitive` — verifies case-insensitive ordering
  - `TestDemuxExecOutput` — 4 cases: Docker multiplexed stream, stderr ignored, non-multiplexed fallback, empty input
  - `TestParseLsOutput` — verifies dot entries and total line are skipped
  - `FuzzValidatePath` — 8 seed values, checks absolute path result, no null bytes, idempotency
- `internal/api/middleware_test.go`: Unit tests:
  - `TestPathValidationMiddleware` — 7 cases: valid path cleaned, trailing slash cleaned, root passes, relative path returns 400, dotdot cleans to valid path, missing path param passes through, empty path value passes through
  - `TestReadOnlyMiddleware` — 9 cases: PUT/POST/DELETE blocked in readonly mode, GET passes, all methods pass when not readonly, non-API paths pass through even in readonly
  - `TestLoggingMiddleware` — verifies no panic and response passes through
  - `TestLoggingMiddleware_CapturesStatusCode` — verifies non-200 status codes captured
- `internal/docker/filesystem_integration_test.go`: Integration tests (`//go:build integration`):
  - Uses `testcontainers-go` to spin up nginx:alpine container in `TestMain`
  - `TestListDir_Root` — lists `/`, verifies etc/var/usr directories exist
  - `TestListDir_Nested` — lists `/etc/nginx`, verifies nginx.conf exists with type "file"
  - `TestReadFile` — reads `/etc/nginx/nginx.conf`, verifies positive size and "worker_processes" in content
  - `TestWriteFile` — writes test content to `/tmp/integration-test.txt`, reads back, verifies match
  - `TestDeletePath` — writes file, verifies exists via StatPath, deletes, verifies StatPath fails
  - `TestSearchFiles` — searches for "nginx.conf" in `/etc`, verifies found in results
  - `TestDeletePath_RootRejected` — verifies DeletePath("/") returns error
- `Dockerfile`: Multi-stage build: `golang:1.24-alpine` builder (installs git, downloads deps, builds with ldflags) → `alpine:3.19` runtime with `ca-certificates`. Entrypoint is `containervisualize`.
- `.github/workflows/ci.yml`: Triggers on push/PR to master. Three jobs: `test` (make test + make build + verify --version), `lint` (golangci-lint-action@v6), `integration` (make test-integration). All use Go 1.24.
- `.github/workflows/release.yml`: Triggers on tag push (`v*`). Builds release binaries via `make release`, creates GitHub release with `softprops/action-gh-release@v2` including all cross-compiled binaries.
- `Makefile`: Added `docker` target (`docker build -t containervisualize --build-arg VERSION=$(VERSION) .`). Added `docker` to `.PHONY` list.
- `go.mod`: Added `testcontainers-go` dependency for integration tests.

**All 5 phases are now complete. The project is production-ready.**

### Manual Testing

Prerequisites: Docker running, at least one container running (e.g., `docker run -d --name test-nginx nginx`).

```bash
# 1. Build the binary
make build

# 2. Run against a container
./bin/containervisualize -c test-nginx --no-open -v

# 3. Open http://localhost:9500 in a browser
#    - You should see the Container Visualize UI with a dark theme
#    - The header shows "Container Visualize", a search input, and a container badge (name, image, green dot if running)
#    - The left sidebar shows the file tree starting at /
#    - Click a directory to expand it (lazy-loads children from the API, shows spinner while loading)
#    - Click a file to view its contents in the CodeMirror editor (right pane, shows spinner while loading)
#    - Editor has syntax highlighting (material-darker theme), line numbers, bracket matching, code folding
#    - Click the refresh button (↻) in the header to reload the tree
#    - The sidebar is resizable by dragging the border between sidebar and content
#    - The status bar shows: connection status (left), file info (center), container name (right)

# 4. Test the editor and file saving:
#    - Open a text file (e.g., /etc/hostname)
#    - Edit the content in the CodeMirror editor
#    - A blue dot appears next to the filename indicating unsaved changes
#    - Click "Save" button or press Ctrl+S / Cmd+S
#    - A green toast notification "File saved" appears in the bottom-right
#    - Close and reopen the file to confirm the change persisted
#    - Status bar center shows: file path · size · line count · UTF-8

# 5. Test markdown preview:
#    - Open a .md file (or create one via the API)
#    - Click the "Preview" button to see rendered markdown
#    - Click "Edit" to go back to the CodeMirror editor

# 6. Test search functionality:
#    - Press Ctrl+P / Cmd+P to focus the search input
#    - Type a filename (e.g., "hostname") — results appear in dropdown after 300ms
#    - Use arrow keys to navigate, Enter to select
#    - Clicking a result expands parent directories and opens the file
#    - Press Escape to dismiss search results
#    - Prefix with "content:" to search file contents (e.g., "content:root")
curl "http://localhost:9500/api/search?q=hostname&path=/"    # Search by filename
curl "http://localhost:9500/api/search?q=content:root&path=/"  # Search file contents

# 7. Test theme toggle:
#    - Click the theme toggle button (☾) in the header
#    - UI switches to light theme (Catppuccin Latte colors)
#    - CodeMirror editor switches to default (light) theme
#    - Click again to switch back to dark theme
#    - Preference persists across page reloads (stored in localStorage)

# 8. Test keyboard shortcuts:
#    - Ctrl/Cmd+S: Save current file
#    - Ctrl/Cmd+P: Focus search input
#    - Ctrl/Cmd+Shift+E: Focus file tree
#    - Escape: Close search dropdown / context menu
#    - Delete/Backspace (when tree panel focused): Delete selected item (with confirmation)

# 9. Test the API endpoints directly:
curl http://localhost:9500/api/container          # Container metadata JSON
curl http://localhost:9500/api/tree?path=/         # Directory listing JSON array
curl "http://localhost:9500/api/file?path=/etc/hostname"  # File contents with detected Content-Type
curl -X PUT "http://localhost:9500/api/file?path=/tmp/test.txt" -d "hello world"  # Save file

# 10. Test file upload (browser):
#    - Click the upload button (↟) in the header
#    - Select a file from your computer
#    - A spinner overlay appears on the sidebar during upload
#    - A green toast notification "Uploaded <filename>" appears
#    - The file tree refreshes and shows the new file

# 11. Test context menu:
#    - Right-click a file in the tree → see Download, Delete, Copy Path options
#    - Right-click a directory → see New File, Upload File Here, Download as Archive, Delete, Copy Path
#    - Click "Copy Path" → path is copied to clipboard, toast confirms
#    - Click "New File" → enter a filename → file is created, tree refreshes
#    - Click "Download" on a file → file downloads
#    - Click "Download as Archive" on a directory → tar.gz downloads
#    - Click "Delete" on a file → confirmation dialog appears → confirm → file is removed

# 12. Test drag and drop:
#    - Drag a file from your desktop onto the tree panel
#    - The tree panel shows a dashed outline, directories highlight on hover
#    - Drop the file → it uploads to the hovered directory
#    - Toast confirms upload, tree refreshes

# 13. Test delete confirmation:
#    - Right-click a file → Delete → confirmation dialog appears
#    - Click Cancel → nothing happens
#    - Click Delete → file is removed from tree, editor clears if that file was open

# 14. Test archive download:
curl "http://localhost:9500/api/archive?path=/etc" --output etc.tar.gz  # Downloads directory as tar.gz
curl "http://localhost:9500/api/archive?path=/etc/hostname" --output hostname  # Downloads single file

# 15. Test upload via API:
curl -X POST "http://localhost:9500/api/file?path=/tmp" -F "file=@/path/to/local/file"  # Upload file

# 16. Test delete via API:
curl -X DELETE "http://localhost:9500/api/file?path=/tmp/test.txt"  # Delete file
curl -X DELETE "http://localhost:9500/api/file?path=/"  # Should return 403 Forbidden

# 17. Test readonly mode:
./bin/containervisualize -c test-nginx --no-open --readonly -v
# Then:
curl -X PUT http://localhost:9500/api/file?path=/tmp/test     # Should return 403 Forbidden
curl -X POST http://localhost:9500/api/file?path=/tmp -F "file=@test" # Should return 403 Forbidden
curl -X DELETE http://localhost:9500/api/file?path=/tmp/test   # Should return 403 Forbidden
# In the browser: upload/delete buttons show "read-only mode" toast, editor is read-only

# 18. Test path validation:
curl "http://localhost:9500/api/tree?path=../../../etc"  # Should return 400 Bad Request

# 19. Test connection error handling:
#    - With the UI open, stop the Docker container: docker stop test-nginx
#    - A red "Container has stopped" banner appears at the top with a "Reconnect" button
#    - The status bar shows a red dot + "Disconnected"
#    - Restart the container: docker start test-nginx
#    - Click "Reconnect" or wait — the banner disappears, a toast shows "Connection restored"
#    - Stop the Docker daemon entirely to see the full-screen "Connection to Docker lost" overlay

# 20. Stop the server with Ctrl+C (graceful shutdown)
```

## Things to Avoid

- Don't add a `pkg/` or `util/` directory. If something needs to be shared, put it in `internal/model/`.
- Don't add third-party dependencies for things the stdlib handles (HTTP routing, JSON encoding, tar, gzip, logging, testing).
- Don't create React/Vue/Svelte components. This is vanilla JS.
- Don't use `docker exec` via `os/exec`. Use the Docker SDK's `ContainerExecCreate` and `ExecAttach`.
- Don't buffer entire files in memory for read/write operations. Stream everything.
- Don't add WebSocket support in v1. Manual refresh is fine for now.
- Don't create separate CSS/JS files per component beyond the existing 6 JS files and 1 CSS file.
- Don't add authentication in v1. Localhost binding is the security model.
