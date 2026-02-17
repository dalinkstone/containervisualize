package model

import "time"

// FileNode represents a file, directory, or symlink inside a container.
type FileNode struct {
	Name        string     `json:"name"`
	Path        string     `json:"path"`
	Type        string     `json:"type"` // "file", "directory", "symlink"
	Size        int64      `json:"size"`
	Modified    time.Time  `json:"modified"`
	Permissions string     `json:"permissions"`
	Children    []FileNode `json:"children,omitempty"`
	LinkTarget  string     `json:"linkTarget,omitempty"`
}

// ContainerInfo holds metadata about a Docker container.
type ContainerInfo struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Image    string    `json:"image"`
	Status   string    `json:"status"`
	Created  time.Time `json:"created"`
	Platform string    `json:"platform"`
}

// APIError is the standard error response from the API.
type APIError struct {
	Error  string `json:"error"`
	Path   string `json:"path,omitempty"`
	Status int    `json:"status"`
}
