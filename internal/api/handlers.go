package api

import (
	"fmt"
	"io"
	"net/http"

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
	defer reader.Close()

	// Read first 512 bytes for content type detection
	buf := make([]byte, 512)
	n, _ := reader.Read(buf)
	buf = buf[:n]

	contentType := http.DetectContentType(buf)

	w.Header().Set("Content-Type", contentType)
	if size > 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	}
	w.WriteHeader(http.StatusOK)

	// Write the buffered bytes first, then stream the rest
	w.Write(buf)
	io.Copy(w, reader)
}

func (h *Handlers) handleUpdateFile(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}

func (h *Handlers) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}

func (h *Handlers) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}
