package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dalinkstone/containervisualize/internal/model"
)

func TestPathValidationMiddleware(t *testing.T) {
	// The inner handler records what path it received
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(path))
	})

	handler := PathValidationMiddleware(inner)

	tests := []struct {
		name       string
		query      string
		wantStatus int
		wantPath   string
	}{
		{
			name:       "valid path passes through cleaned",
			query:      "?path=/etc/nginx",
			wantStatus: http.StatusOK,
			wantPath:   "/etc/nginx",
		},
		{
			name:       "path with trailing slash cleaned",
			query:      "?path=/etc/",
			wantStatus: http.StatusOK,
			wantPath:   "/etc",
		},
		{
			name:       "root path passes",
			query:      "?path=/",
			wantStatus: http.StatusOK,
			wantPath:   "/",
		},
		{
			name:       "relative path returns 400",
			query:      "?path=../etc/passwd",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "dotdot cleans to valid path",
			query:      "?path=/etc/../../root",
			wantStatus: http.StatusOK,
			wantPath:   "/root",
		},
		{
			name:       "missing path param passes through",
			query:      "",
			wantStatus: http.StatusOK,
			wantPath:   "",
		},
		{
			name:       "empty path value passes through",
			query:      "?path=",
			wantStatus: http.StatusOK,
			wantPath:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/tree"+tt.query, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK && rec.Body.String() != tt.wantPath {
				t.Errorf("path = %q, want %q", rec.Body.String(), tt.wantPath)
			}

			if tt.wantStatus == http.StatusBadRequest {
				var apiErr model.APIError
				if err := json.Unmarshal(rec.Body.Bytes(), &apiErr); err != nil {
					t.Fatalf("failed to parse error response: %v", err)
				}
				if apiErr.Status != http.StatusBadRequest {
					t.Errorf("error status = %d, want %d", apiErr.Status, http.StatusBadRequest)
				}
			}
		})
	}
}

func TestReadOnlyMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	tests := []struct {
		name       string
		readonly   bool
		method     string
		path       string
		wantStatus int
	}{
		// Readonly mode blocks mutations on /api/*
		{"readonly PUT blocked", true, http.MethodPut, "/api/file", http.StatusForbidden},
		{"readonly POST blocked", true, http.MethodPost, "/api/file", http.StatusForbidden},
		{"readonly DELETE blocked", true, http.MethodDelete, "/api/file", http.StatusForbidden},
		{"readonly GET passes", true, http.MethodGet, "/api/tree", http.StatusOK},

		// Non-readonly mode passes everything
		{"writable PUT passes", false, http.MethodPut, "/api/file", http.StatusOK},
		{"writable POST passes", false, http.MethodPost, "/api/file", http.StatusOK},
		{"writable DELETE passes", false, http.MethodDelete, "/api/file", http.StatusOK},
		{"writable GET passes", false, http.MethodGet, "/api/tree", http.StatusOK},

		// Non-API paths pass through even in readonly mode
		{"readonly non-api passes", true, http.MethodPost, "/some/other/path", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := ReadOnlyMiddleware(tt.readonly)(inner)
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusForbidden {
				var apiErr model.APIError
				if err := json.Unmarshal(rec.Body.Bytes(), &apiErr); err != nil {
					t.Fatalf("failed to parse error response: %v", err)
				}
				if apiErr.Status != http.StatusForbidden {
					t.Errorf("error status = %d, want %d", apiErr.Status, http.StatusForbidden)
				}
			}
		})
	}
}

func TestLoggingMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	handler := LoggingMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/tree?path=/", nil)
	rec := httptest.NewRecorder()

	// Should not panic and should pass through the response
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "ok" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "ok")
	}
}

func TestLoggingMiddleware_CapturesStatusCode(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	})

	handler := LoggingMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}
