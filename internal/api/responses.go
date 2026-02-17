package api

import (
	"encoding/json"
	"net/http"

	"github.com/dalinkstone/containervisualize/internal/model"
)

// WriteJSON marshals data to JSON and writes it to the response.
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// WriteError writes an APIError JSON response.
func WriteError(w http.ResponseWriter, status int, message string, path string) {
	WriteJSON(w, status, model.APIError{
		Error:  message,
		Path:   path,
		Status: status,
	})
}
