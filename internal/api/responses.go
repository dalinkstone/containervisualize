package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/dalinkstone/containervisualize/internal/model"
)

// WriteJSON marshals data to JSON and writes it to the response.
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// WriteError writes an APIError JSON response.
func WriteError(w http.ResponseWriter, status int, message string, path string) {
	WriteJSON(w, status, model.APIError{
		Error:  message,
		Path:   path,
		Status: status,
	})
}

// StreamContent sets appropriate headers and copies the reader to the response.
func StreamContent(w http.ResponseWriter, reader io.ReadCloser, filename string, contentType string, size int64) {
	defer reader.Close()

	w.Header().Set("Content-Type", contentType)
	if filename != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filename))
	}
	if size > 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, reader)
}
