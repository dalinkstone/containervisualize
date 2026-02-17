package api

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/dalinkstone/containervisualize/internal/docker"
)

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// LoggingMiddleware logs each request with method, path, status, and duration.
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.statusCode,
			"duration", time.Since(start).String(),
		)
	})
}

// ReadOnlyMiddleware rejects PUT, POST, DELETE on /api/* when readonly is true.
func ReadOnlyMiddleware(readonly bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if readonly && strings.HasPrefix(r.URL.Path, "/api/") {
				switch r.Method {
				case http.MethodPut, http.MethodPost, http.MethodDelete:
					WriteError(w, http.StatusForbidden, "server is in read-only mode", r.URL.Path)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// PathValidationMiddleware validates and cleans the "path" query parameter.
func PathValidationMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pathParam := r.URL.Query().Get("path")
		if pathParam != "" {
			cleaned, err := docker.ValidatePath(pathParam)
			if err != nil {
				WriteError(w, http.StatusBadRequest, err.Error(), pathParam)
				return
			}
			// Set the cleaned path back on the query
			q := r.URL.Query()
			q.Set("path", cleaned)
			r.URL.RawQuery = q.Encode()
		}
		next.ServeHTTP(w, r)
	})
}
