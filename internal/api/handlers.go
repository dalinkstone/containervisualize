package api

import (
	"bytes"
	"io"
	"net/http"
	"path/filepath"

	"github.com/dalinkstone/containervisualize/internal/docker"
)

// Handlers holds dependencies for HTTP handlers.
type Handlers struct {
	Docker      *docker.DockerClient
	ContainerID string
}

func (h *Handlers) handleGetContainer(w http.ResponseWriter, r *http.Request) {
	info, err := h.Docker.GetContainerInfo(r.Context(), h.ContainerID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), "")
		return
	}
	WriteJSON(w, http.StatusOK, info)
}

func (h *Handlers) handleGetTree(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	nodes, err := h.Docker.ListDir(r.Context(), h.ContainerID, path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), path)
		return
	}
	WriteJSON(w, http.StatusOK, nodes)
}

func (h *Handlers) handleGetFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteError(w, http.StatusBadRequest, "path parameter is required", "")
		return
	}

	reader, size, err := h.Docker.ReadFile(r.Context(), h.ContainerID, path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), path)
		return
	}

	// Read first 512 bytes for content type detection
	buf := make([]byte, 512)
	n, _ := reader.Read(buf)
	buf = buf[:n]

	contentType := http.DetectContentType(buf)
	filename := filepath.Base(path)

	// Re-combine the buffered bytes with the remaining stream
	combined := io.NopCloser(io.MultiReader(
		bytes.NewReader(buf),
		reader,
	))

	StreamContent(w, combined, filename, contentType, size)
}

func (h *Handlers) handleUpdateFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteError(w, http.StatusBadRequest, "path parameter is required", "")
		return
	}

	defer r.Body.Close()

	// Read the body into a buffer so we know the size for the tar header
	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "failed to read request body", path)
		return
	}

	err = h.Docker.WriteFile(r.Context(), h.ContainerID, path, bytes.NewReader(body), int64(len(body)))
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), path)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}

func (h *Handlers) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}

func (h *Handlers) handleGetArchive(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}

func (h *Handlers) handleSearch(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}
