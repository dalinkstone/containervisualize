package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

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
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		dirPath = "/"
	}

	// Limit upload size to 50MB
	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)

	err := r.ParseMultipartForm(50 << 20)
	if err != nil {
		WriteError(w, http.StatusBadRequest, fmt.Sprintf("failed to parse multipart form: %s", err.Error()), dirPath)
		return
	}

	var uploaded []string

	for _, fileHeaders := range r.MultipartForm.File {
		for _, fh := range fileHeaders {
			file, err := fh.Open()
			if err != nil {
				WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to open uploaded file: %s", err.Error()), dirPath)
				return
			}

			content, err := io.ReadAll(file)
			file.Close()
			if err != nil {
				WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to read uploaded file: %s", err.Error()), dirPath)
				return
			}

			// Create a tar archive containing the file
			var tarBuf bytes.Buffer
			tw := tar.NewWriter(&tarBuf)
			header := &tar.Header{
				Name:    fh.Filename,
				Size:    int64(len(content)),
				Mode:    0644,
				ModTime: time.Now(),
			}
			if err := tw.WriteHeader(header); err != nil {
				WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to write tar header: %s", err.Error()), dirPath)
				return
			}
			if _, err := tw.Write(content); err != nil {
				WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to write tar content: %s", err.Error()), dirPath)
				return
			}
			tw.Close()

			// Copy to container
			err = h.Docker.CopyToContainer(r.Context(), h.ContainerID, dirPath, &tarBuf)
			if err != nil {
				WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to upload file: %s", err.Error()), dirPath)
				return
			}

			filePath := dirPath
			if !strings.HasSuffix(filePath, "/") {
				filePath += "/"
			}
			filePath += fh.Filename
			uploaded = append(uploaded, filePath)
		}
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"files":  uploaded,
	})
}

func (h *Handlers) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteError(w, http.StatusBadRequest, "path parameter is required", "")
		return
	}

	if path == "/" {
		WriteError(w, http.StatusForbidden, "cannot delete root path", "/")
		return
	}

	err := h.Docker.DeletePath(r.Context(), h.ContainerID, path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), path)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "path": path})
}

func (h *Handlers) handleGetArchive(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		WriteError(w, http.StatusBadRequest, "path parameter is required", "")
		return
	}

	// Check if path is a file or directory
	stat, err := h.Docker.StatPath(r.Context(), h.ContainerID, path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), path)
		return
	}

	if stat.Type == "file" {
		// Single file: serve with Content-Disposition: attachment
		reader, size, err := h.Docker.ReadFile(r.Context(), h.ContainerID, path)
		if err != nil {
			WriteError(w, http.StatusInternalServerError, err.Error(), path)
			return
		}
		defer reader.Close()

		filename := filepath.Base(path)
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		io.Copy(w, reader)
		return
	}

	// Directory: stream as tar.gz
	tarReader, err := h.Docker.ArchiveDir(r.Context(), h.ContainerID, path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err.Error(), path)
		return
	}
	defer tarReader.Close()

	dirname := filepath.Base(path)
	if dirname == "/" || dirname == "." {
		dirname = "root"
	}

	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", dirname+".tar.gz"))

	gz := gzip.NewWriter(w)
	defer gz.Close()

	io.Copy(gz, tarReader)
}

func (h *Handlers) handleSearch(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not implemented", "")
}
