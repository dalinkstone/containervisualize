package api

import (
	"io/fs"
	"net/http"

	"github.com/dalinkstone/containervisualize/internal/docker"
)

// NewRouter creates and configures the HTTP route handler.
func NewRouter(dockerClient *docker.DockerClient, containerID string, readonly bool, staticFS fs.FS) http.Handler {
	h := &Handlers{
		Docker:      dockerClient,
		ContainerID: containerID,
	}

	mux := http.NewServeMux()

	// API routes with path validation
	apiWithPath := func(handler http.HandlerFunc) http.Handler {
		return PathValidationMiddleware(handler)
	}

	mux.Handle("GET /api/container", http.HandlerFunc(h.handleGetContainer))
	mux.Handle("GET /api/tree", apiWithPath(h.handleGetTree))
	mux.Handle("GET /api/file", apiWithPath(h.handleGetFile))
	mux.Handle("PUT /api/file", apiWithPath(h.handleUpdateFile))
	mux.Handle("POST /api/file", apiWithPath(h.handleUploadFile))
	mux.Handle("DELETE /api/file", apiWithPath(h.handleDeleteFile))
	mux.Handle("GET /api/archive", apiWithPath(h.handleGetArchive))
	mux.Handle("GET /api/search", apiWithPath(h.handleSearch))

	// Serve embedded static files
	staticServer := http.FileServerFS(staticFS)
	mux.Handle("/", staticServer)

	// Apply global middleware: readonly then logging (outermost)
	var handler http.Handler = mux
	handler = ReadOnlyMiddleware(readonly)(handler)
	handler = LoggingMiddleware(handler)

	return handler
}
