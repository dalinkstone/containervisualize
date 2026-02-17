# Execution Plan — Container Visualize

This document contains the prompts to feed into Claude Code, in order, to build the project. Each prompt corresponds to a phase and produces working, testable output before moving to the next.

**Before starting:** Clone the repo and ensure Go 1.22+ and Docker are installed.

```bash
git clone https://github.com/dalinkstone/containervisualize.git
cd containervisualize
```

---

## Phase 1 — Project Skeleton + Docker Client + Tree API + Basic UI

### Prompt 1.1: Project initialization and Docker client

```
Initialize a Go project for "github.com/dalinkstone/containervisualize". 

Create the project structure:
- cmd/containervisualize/main.go
- internal/docker/client.go
- internal/docker/filesystem.go
- internal/docker/container.go
- internal/model/types.go
- internal/api/router.go
- internal/api/handlers.go
- internal/api/middleware.go
- internal/api/responses.go
- web/embed.go
- web/static/ (empty placeholder index.html)
- Makefile
- go.mod

For main.go:
- Use the `flag` package to parse CLI flags: --container/-c (required, string), --port/-p (default 9500, int), --host (default "127.0.0.1", string), --readonly (bool), --depth (default 3, int), --docker-host (default "", string — empty means use default), --no-open (bool), --verbose/-v (bool)
- Validate that --container is provided, exit with usage if not
- Initialize the Docker client from internal/docker
- Initialize the API router and start the HTTP server
- Print a startup message with the URL
- If --no-open is not set, attempt to open the browser (use exec for xdg-open/open depending on OS)
- Handle graceful shutdown on SIGINT/SIGTERM

For internal/model/types.go:
- Define FileNode struct: Name string, Path string, Type string (file/directory/symlink), Size int64, Modified time.Time, Permissions string, Children []FileNode (pointer, nullable), LinkTarget string (for symlinks)
- Define ContainerInfo struct: ID string, Name string, Image string, Status string, Created time.Time, Platform string
- Define APIError struct: Error string, Path string, Status int

For internal/docker/client.go:
- Create a DockerClient struct that wraps the official Docker SDK client (github.com/docker/docker/client)
- Constructor: NewDockerClient(dockerHost string) that creates the SDK client. If dockerHost is empty, use client.FromEnv()
- Add a Ping method to verify Docker connectivity
- Add a Close method

For internal/docker/container.go:
- Method: GetContainerInfo(ctx, containerID) returning ContainerInfo
- Use the SDK's ContainerInspect to get container details
- Map the inspect result to our ContainerInfo type
- Return clear error if container not found or not running

For internal/docker/filesystem.go:
- Implement ListDir(ctx, containerID, path string) ([]FileNode, error):
  - First attempt: use ContainerExecCreate + ExecAttach to run ["ls", "-la", "--time-style=full-iso", "--", path]
  - Parse the ls output line-by-line into FileNode structs (write a parseLsLine function)
  - Skip the "total" line at the top
  - Handle symlinks (parse "-> target" from ls output)
  - Fallback: if exec fails (exit code non-zero or ls not found), use CopyFromContainer on the path and read tar headers only
  - Sort results: directories first, then files, alphabetically within each group

- Implement StatPath(ctx, containerID, path string) (*FileNode, error):
  - Use the SDK's ContainerStatPath which returns types.ContainerPathStat
  - Map to our FileNode type

- Implement ReadFile(ctx, containerID, path string) (io.ReadCloser, int64, error):
  - Use CopyFromContainer which returns a tar stream
  - Read the tar, find the single entry, return its content as io.ReadCloser and its size
  - If the path is a directory, return an error

Make sure all file paths passed to Docker SDK methods are cleaned with filepath.Clean and validated (must be absolute, no ".." components, no null bytes). Create a ValidatePath(path string) (string, error) helper for this.

Run `go mod tidy` after creating all files. Verify it compiles with `go build ./cmd/containervisualize`.
```

### Prompt 1.2: API layer and basic routing

```
Now build the API layer in internal/api/.

For internal/api/responses.go:
- Helper function: WriteJSON(w http.ResponseWriter, status int, data any) that marshals to JSON and writes with proper Content-Type header
- Helper function: WriteError(w http.ResponseWriter, status int, message string, path string) that writes an APIError as JSON
- Helper function: StreamContent(w http.ResponseWriter, reader io.ReadCloser, filename string, contentType string, size int64) that sets appropriate headers and copies the reader to the response

For internal/api/middleware.go:
- LoggingMiddleware: wraps handler, logs method, path, status code, and duration using slog
- ReadOnlyMiddleware(readonly bool): returns middleware that rejects PUT/POST/DELETE to /api/* with 403 if readonly is true
- PathValidationMiddleware: for requests with a "path" query parameter, run ValidatePath on it. If invalid, return 400. If valid, set the cleaned path back on the query.

For internal/api/router.go:
- Create a NewRouter function that takes the DockerClient, containerID string, readonly bool, and the embedded filesystem (for static assets)
- Register routes using Go 1.22 http.ServeMux patterns:
  - GET /api/container → handleGetContainer
  - GET /api/tree → handleGetTree  
  - GET /api/file → handleGetFile
  - PUT /api/file → handleUpdateFile (placeholder for now, return 501)
  - POST /api/file → handleUploadFile (placeholder for now, return 501)
  - DELETE /api/file → handleDeleteFile (placeholder for now, return 501)
  - GET / → serve embedded static files (use http.FileServer with the embedded FS)
- Apply middleware: Logging wraps everything, ReadOnly wraps /api/*, PathValidation wraps /api/tree, /api/file, /api/archive, /api/search

For internal/api/handlers.go:
- handleGetContainer: call docker.GetContainerInfo, return JSON
- handleGetTree: extract "path" query param (default "/"), call docker.ListDir, return JSON array of FileNodes
- handleGetFile: extract "path" query param, call docker.ReadFile, detect content type using http.DetectContentType on first 512 bytes (buffer and re-prepend), stream response with appropriate Content-Type and Content-Disposition headers

For web/embed.go:
- Use //go:embed static/* to embed the entire static directory
- Export the filesystem as a variable the router can use

Update main.go to wire everything together: create DockerClient, create Router, start http.Server.

Create a minimal web/static/index.html that just says "Container Visualize - API is working" so we can verify the server starts.

Verify: `go build ./cmd/containervisualize && ./bin/containervisualize -c <test-container>` should start the server, and `curl http://localhost:9500/api/container` should return container JSON.
```

### Prompt 1.3: Basic file tree UI

```
Now build the frontend. Create/update these files in web/static/:

web/static/index.html:
- Single page app shell with:
  - A header bar with the app name "Container Visualize" and a container info badge (populated by JS)
  - A main area split into two panes: left sidebar (file tree, ~300px wide, resizable) and right content area (editor/viewer)
  - A status bar at the bottom
- Load css/style.css
- Load js/api.js, js/tree.js, js/editor.js, js/toolbar.js, js/app.js in that order via script tags
- Include a link to load CodeMirror 6 from cdnjs.cloudflare.com (we'll use it later):
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
  Actually, for v1 we'll use CodeMirror 5 from CDN since it's simpler to set up without a bundler. Load codemirror.min.js and a few language modes (javascript, xml/html, css, markdown, python, go, yaml, shell, dockerfile, json).

web/static/js/api.js:
- Create an API object/module with methods:
  - api.getContainer() → GET /api/container
  - api.getTree(path) → GET /api/tree?path=...
  - api.getFile(path) → GET /api/file?path=... (returns {content, contentType, size})
  - api.updateFile(path, content) → PUT /api/file?path=... (for later)
  - api.uploadFile(dirPath, file) → POST /api/file?path=... (for later)
  - api.deleteFile(path) → DELETE /api/file?path=... (for later)
- All methods return promises. On non-2xx responses, throw with the error message from the JSON body.
- For getFile, if content-type is text/*, return the text. Otherwise return a blob.

web/static/js/tree.js:
- Create a FileTree class that manages the tree UI
- Constructor takes a container DOM element
- Method: loadRoot() — fetches GET /api/tree?path=/ and renders the root entries
- Method: renderNode(node, parentEl, depth) — creates a tree item element:
  - Directory: folder icon (use Unicode 📁 or CSS), name, click to toggle expand
  - File: file icon (📄), name, click to open in editor
  - Symlink: link icon (🔗), name + " → target"
  - Show file size for files (humanized: KB, MB)
  - Indent based on depth
- When a directory is clicked and expanded for the first time, fetch its children from /api/tree?path=<dir_path> and render them
- Track expanded state so re-clicking collapses without re-fetching
- Highlight the currently selected file
- Add a method: refresh() that reloads the currently visible tree state
- Use event delegation on the tree container for click handling (don't attach listeners to every node)

web/static/js/editor.js:
- Create an EditorPanel class
- Constructor takes a container DOM element
- Method: openFile(path, content, contentType) — displays file content:
  - If text: show in a <pre><code> block for now (CodeMirror integration in Phase 2)
  - If image (contentType starts with image/): show <img> with object URL
  - If binary: show "Binary file (X bytes)" with a download link
- Method: clear() — clears the panel
- Show the file path in a breadcrumb above the content area

web/static/js/toolbar.js:
- Create a Toolbar class
- Constructor takes the header DOM element
- Method: setContainerInfo(info) — updates the container badge with name, image, status
- Bind the refresh button to trigger tree.refresh()
- (Upload and other buttons will be functional in Phase 3)

web/static/js/app.js:
- On DOMContentLoaded:
  - Create instances of FileTree, EditorPanel, Toolbar
  - Fetch container info and display it
  - Load the root tree
  - Wire up: when tree emits a file-select event (use CustomEvent), open it in the editor
  - Wire up: toolbar refresh triggers tree refresh

web/static/css/style.css:
- Dark theme using CSS custom properties:
  --bg-primary: #1e1e2e; --bg-secondary: #181825; --bg-surface: #313244;
  --text-primary: #cdd6f4; --text-secondary: #a6adc8; --accent: #89b4fa;
  --danger: #f38ba8; --success: #a6e3a1; --border: #45475a;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  --font-sans: 'Inter', -apple-system, sans-serif;
- Reset/base styles
- Layout: header fixed top, main area flex row, sidebar left, content right, status bar fixed bottom
- File tree styles: indentation, hover highlight, selected state, icons, expand/collapse arrow
- Editor area: full height, padding, breadcrumb path display
- Responsive: on narrow screens, tree becomes a slide-out panel
- Scrollbar styling for webkit/firefox
- Transitions for tree expand/collapse

Make sure the tree is functional: directories expand/collapse, files can be clicked to view their text content. This completes Phase 1.
```

---

## Phase 2 — CodeMirror Editor + Syntax Highlighting + File Save

### Prompt 2.1: CodeMirror integration and file saving

```
Upgrade the editor to use CodeMirror 5 (from CDN) and implement file saving.

Update web/static/index.html:
- Load CodeMirror 5 from cdnjs.cloudflare.com:
  - codemirror.min.css
  - codemirror.min.js  
  - Themes: load the "material-darker" theme CSS
  - Modes: javascript, xml, htmlmixed, css, markdown, python, go, yaml, shell, dockerfile, clike (for C/Java/etc), toml, sql, ruby, php, rust
  - Addons: active-line, matchbrackets, closebrackets, foldcode, foldgutter, brace-fold, comment-fold, search/search, search/searchcursor, dialog/dialog (css+js), jump-to-line

Update web/static/js/editor.js:
- When opening a text file, create a CodeMirror instance (or reuse existing one via cm.setValue and cm.setOption for mode)
- Detect the CodeMirror mode from file extension:
  - .js/.jsx/.ts/.tsx → javascript
  - .py → python
  - .go → go  
  - .html/.htm → htmlmixed
  - .css/.scss → css
  - .md/.markdown → markdown
  - .yml/.yaml → yaml
  - .sh/.bash/.zsh → shell
  - .json → {name: "javascript", json: true}
  - .xml → xml
  - .sql → sql
  - .rb → ruby
  - .php → php
  - .rs → rust
  - .c/.h → text/x-csrc
  - .java → text/x-java
  - .dockerfile/Dockerfile → dockerfile
  - .toml → toml
  - Default → null (plain text)
- CodeMirror config: theme "material-darker", lineNumbers true, matchBrackets true, autoCloseBrackets true, foldGutter true, styleActiveLine true, tabSize 2, indentWithTabs false, lineWrapping false, readOnly if app is in readonly mode
- Add a "Save" button below the editor (and bind Ctrl+S / Cmd+S keyboard shortcut)
- Save calls api.updateFile(path, cm.getValue())
- Show a toast notification on save success/failure
- Track dirty state: if content has changed since last save/load, show a dot indicator on the file name and prompt before switching files

Now implement the backend save endpoint. Update internal/api/handlers.go:
- handleUpdateFile: read the request body, call a new docker.WriteFile method
  
Update internal/docker/filesystem.go:
- Implement WriteFile(ctx, containerID, path string, content io.Reader, size int64) error:
  - Create a tar archive in memory (bytes.Buffer) containing a single file at the correct path
  - Use archive/tar to write the header (name = base filename, size from parameter, mode 0644, mod time = now)
  - Copy the content reader into the tar
  - Close the tar writer
  - Call CopyToContainer with the tar buffer, setting the destination to the parent directory of the file
  - Important: the tar entry's Name should be just the filename (not full path), and the CopyToContainer destination should be the parent directory

Also add a markdown preview feature to the editor:
- When viewing a .md file, add a toggle button "Preview / Edit"
- Preview mode: render the markdown to HTML using a simple regex-based approach (or include a tiny markdown parser — actually, just use the browser: create a simple function that handles headers, bold, italic, code blocks, lists, links, and paragraphs. Doesn't need to be perfect.)
- Edit mode: show the CodeMirror editor

Add a toast notification system:
- Create a simple toast function in app.js that shows a message in the bottom-right corner
- Auto-dismiss after 3 seconds
- Types: success (green), error (red), info (blue)

Verify: open a text file, edit it, save it, close and reopen it to confirm the change persisted in the container.
```

---

## Phase 3 — Upload, Delete, Download + Context Menus

### Prompt 3.1: File operations (upload, delete, download)

```
Implement the remaining CRUD operations.

Backend — internal/docker/filesystem.go:
- Implement DeletePath(ctx, containerID, path string) error:
  - Validate the path is not "/" (never allow deleting root)
  - Use ExecCreate with Cmd: ["rm", "-rf", "--", path]
  - Attach to exec to read output, check exit code
  - Return appropriate error if deletion fails

- Implement ArchiveDir(ctx, containerID, path string) (io.ReadCloser, error):
  - Use CopyFromContainer which returns a tar stream
  - Return the stream directly (the handler will gzip it)

Backend — internal/api/handlers.go:
- handleUploadFile: 
  - Parse multipart form data with 50MB limit (use http.MaxBytesReader)
  - Get the "path" query param (directory to upload into)
  - For each file in the form:
    - Create a tar archive containing the file
    - CopyToContainer with destination = the target directory
  - Return JSON with list of uploaded file paths

- handleDeleteFile:
  - Get "path" query param
  - Reject if path is "/"
  - Call docker.DeletePath
  - Return 200 with success message

- Add a new handler handleDownloadArchive:
  - Register at GET /api/archive?path=...
  - Call docker.ArchiveDir
  - Pipe through gzip compression (compress/gzip)
  - Set headers: Content-Type: application/gzip, Content-Disposition: attachment; filename="<dirname>.tar.gz"
  - Stream to response
  - Also support downloading single files: if the path points to a file, just serve it with Content-Disposition: attachment

Frontend — web/static/js/api.js:
- Implement api.uploadFile(dirPath, file):
  - Create FormData, append the file
  - POST /api/file?path=<dirPath>
  - Return the response JSON

- Implement api.deleteFile(path):
  - DELETE /api/file?path=<path>
  - Return the response JSON

- Implement api.downloadArchive(path):
  - Open /api/archive?path=<path> in a new tab (or use fetch + blob + download link)

Frontend — web/static/js/tree.js — add context menu:
- On right-click on any tree node, show a custom context menu with options:
  - For files: Download, Delete, Copy Path
  - For directories: New File, Upload File Here, Download as Archive, Delete, Copy Path
  - "New File" prompts for a filename, then creates an empty file via PUT /api/file
- Style the context menu: dark surface, rounded corners, hover highlight, divider lines
- Dismiss on click outside or Escape key
- After delete: remove the node from the tree, clear the editor if the deleted file was open
- After upload: refresh the parent directory in the tree

Frontend — web/static/js/toolbar.js:
- Make the Upload button functional:
  - Click opens a file input dialog
  - Uploads to the currently selected directory (or root if nothing selected)
  - Shows progress indication (or at minimum a spinner)
  - Refreshes the tree after upload
- Add a "Download" button that downloads the currently open file or selected node
- Support drag-and-drop: dropping files onto the tree panel triggers upload to the hovered directory

Add confirmation dialogs for destructive actions:
- Delete: "Are you sure you want to delete <path>? This cannot be undone." with Cancel/Delete buttons
- Style the dialog: modal overlay, dark surface, accent-colored action buttons

Verify: upload a file into a container directory, see it appear in the tree, open it, edit it, save it, delete it, confirm it's gone.
```

---

## Phase 4 — Search, Polish, Theme Toggle

### Prompt 4.1: Search and UI polish

```
Add search functionality and polish the UI.

Backend — internal/api/handlers.go:
- Add handleSearch registered at GET /api/search?q=<query>&path=<root_path>:
  - Use ExecCreate to run ["find", path, "-maxdepth", "10", "-name", "*<query>*", "-type", "f"] to search filenames
  - Also add a variant: if query starts with "content:" then search file contents using ["grep", "-rl", "--include=*", query, path] (limit to first 100 results)
  - Parse the output into a list of matching file paths
  - Return JSON array of {path, name, type} for each match
  - Add a timeout of 10 seconds on the exec (use context.WithTimeout)

Backend — internal/docker/filesystem.go:
- Add SearchFiles(ctx, containerID, rootPath, query string, searchContent bool) ([]FileNode, error)
  - Implement as described above
  - Sanitize the query: strip any shell-special characters since we're passing as exec args (not through a shell, but be safe)

Frontend — web/static/js/toolbar.js:
- Add a search input field in the toolbar
- On typing (debounced 300ms), if fewer than 50 nodes are loaded in tree, search client-side (filter visible nodes)
- If query length >= 3, also show a "Search in container" button that calls the backend search API
- Display search results in a dropdown below the search input:
  - Each result shows the file path and a snippet of the matching segment
  - Click a result to navigate the tree to that file (expand parent directories) and open it
  - Escape or clear input to dismiss results

Frontend — web/static/css/style.css — add a light theme and toggle:
- Define light theme variables:
  --bg-primary: #eff1f5; --bg-secondary: #e6e9ef; --bg-surface: #ccd0da;
  --text-primary: #4c4f69; --text-secondary: #6c6f85; --accent: #1e66f5;
  --danger: #d20f39; --success: #40a02b; --border: #bcc0cc;
- Add a theme toggle button in the toolbar (sun/moon icon)
- Store preference in localStorage
- Apply via data-theme="dark|light" on <html> element

Frontend — status bar improvements:
- Left: connection status indicator (green dot + "Connected" / red dot + "Disconnected")
- Center: current file info — path, size (humanized), encoding (UTF-8), line count
- Right: container name + status

Add keyboard shortcuts:
- Ctrl/Cmd+S: Save current file
- Ctrl/Cmd+P: Focus search input
- Ctrl/Cmd+Shift+E: Focus file tree
- Escape: Close search results / context menu / modal
- Delete/Backspace (when tree focused): Delete selected node (with confirmation)
- F2 (when tree node focused): Rename (stretch goal — requires exec mv)

Error handling polish:
- If Docker connection is lost, show a full-screen overlay "Connection to Docker lost. Retrying..." with auto-retry every 5 seconds
- If container stops while viewing, show "Container has stopped" banner with option to reconnect when it restarts
- API errors show as toast notifications with the error message

Loading states:
- Tree nodes show a spinner while their children are loading
- Editor shows a centered spinner while file content is loading
- Upload shows a progress overlay on the tree panel

Verify: search for a filename, see results, click to navigate. Toggle theme. Test keyboard shortcuts. Test error states by stopping the container while the UI is open.
```

---

## Phase 5 — Testing, Build, CI/CD, Release

### Prompt 5.1: Tests and build infrastructure

```
Add tests, build system, and CI configuration.

Create Makefile:
```makefile
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY := containervisualize
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: build test lint clean release

build:
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY) ./cmd/containervisualize

test:
	go test -v -race -count=1 ./...

test-integration:
	go test -v -race -tags=integration -count=1 ./...

lint:
	golangci-lint run ./...

clean:
	rm -rf bin/

release:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-amd64 ./cmd/containervisualize
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-arm64 ./cmd/containervisualize
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-darwin-arm64 ./cmd/containervisualize
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-darwin-amd64 ./cmd/containervisualize
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-windows-amd64.exe ./cmd/containervisualize

fmt:
	gofmt -s -w .

dev:
	go run ./cmd/containervisualize --container $(CONTAINER) --verbose
```

Create unit tests:

internal/docker/filesystem_test.go:
- TestValidatePath: table-driven tests for path validation
  - Valid: "/", "/etc", "/etc/nginx/nginx.conf", "/var/log/../log/syslog" (cleans to /var/log/syslog)
  - Invalid: "../etc/passwd", "relative/path", "/etc/../../root", paths with null bytes, empty string
- TestParseLsLine: table-driven tests for ls output parsing
  - Regular file: "-rw-r--r-- 1 root root 1234 2024-01-15 10:30:00.000000000 +0000 nginx.conf"
  - Directory: "drwxr-xr-x 2 root root 4096 2024-01-15 10:30:00.000000000 +0000 conf.d"
  - Symlink: "lrwxrwxrwx 1 root root 12 2024-01-15 10:30:00.000000000 +0000 link -> /target"
  - Edge cases: filenames with spaces, very large file sizes, different ownership

internal/docker/filesystem_integration_test.go (build tag: integration):
- Use testcontainers-go to spin up an nginx container
- TestListDir_Root: list "/" and verify expected directories exist (etc, var, usr, etc.)
- TestListDir_Nested: list "/etc/nginx" and verify nginx.conf exists
- TestReadFile: read "/etc/nginx/nginx.conf" and verify it contains "worker_processes"
- TestWriteFile: write a test file, then read it back and verify content matches
- TestDeletePath: write a test file, delete it, then verify StatPath returns not found
- TestListDir_FallbackForScratchContainers: test with a minimal "busybox" container

internal/api/middleware_test.go:
- TestPathValidationMiddleware: test that cleaned paths are set, bad paths return 400
- TestReadOnlyMiddleware: test that PUT/POST/DELETE return 403 when readonly=true, GET passes through
- TestLoggingMiddleware: test that log output contains expected fields

Create .github/workflows/ci.yml:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: make test
      - run: make build

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - uses: golangci/golangci-lint-action@v4

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: make test-integration
```

Create .github/workflows/release.yml:
```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: make release
      - uses: softprops/action-gh-release@v2
        with:
          files: bin/*
```

Create Dockerfile:
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /containervisualize ./cmd/containervisualize

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /containervisualize /usr/local/bin/
ENTRYPOINT ["containervisualize"]
```

Create .gitignore:
```
bin/
*.exe
.DS_Store
```

Add a --version flag to main.go that prints the version (set via ldflags) and exits.

Run all tests, fix any issues, verify CI would pass.
```

---

## Post-Build Verification Checklist

After all phases are complete, manually verify:

- [ ] `go build` produces a single binary with embedded web UI
- [ ] Binary starts and connects to a Docker container
- [ ] File tree loads and directories expand/collapse
- [ ] Text files open in CodeMirror with syntax highlighting
- [ ] File edits save successfully and persist
- [ ] File upload works via toolbar button and drag-and-drop
- [ ] File deletion works with confirmation dialog
- [ ] Directory download produces valid tar.gz
- [ ] Search finds files by name
- [ ] Theme toggle works and preference persists
- [ ] Keyboard shortcuts work (Ctrl+S, Ctrl+P, Escape)
- [ ] Read-only mode blocks all write operations
- [ ] Error states display correctly (container stopped, file not found)
- [ ] `make test` passes
- [ ] `make build` and `make release` produce binaries
- [ ] Docker build works

---

## Future Enhancements (v2 Ideas, Not In Scope)

- WebSocket-based live filesystem watching
- Terminal emulator (xterm.js) for exec into container
- Multi-container support (select from running containers)
- File diff viewer for unsaved changes
- Git integration (show git status in tree if container has git)
- Authentication for non-localhost deployments
- Split pane for viewing two files simultaneously
- Image thumbnail previews in the file tree
