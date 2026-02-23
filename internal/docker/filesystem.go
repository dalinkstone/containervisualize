package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dalinkstone/containervisualize/internal/model"
	"github.com/docker/docker/api/types/container"
)

// ValidatePath cleans and validates a container file path.
// It requires absolute paths, rejects ".." components and null bytes.
func ValidatePath(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}

	if strings.ContainsRune(path, 0) {
		return "", fmt.Errorf("path contains null byte")
	}

	cleaned := filepath.Clean(path)

	if !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("path must be absolute: %s", path)
	}

	// Reject paths that still contain ".." after cleaning
	for _, part := range strings.Split(cleaned, string(filepath.Separator)) {
		if part == ".." {
			return "", fmt.Errorf("path contains '..' component: %s", path)
		}
	}

	return cleaned, nil
}

// ListDir lists the contents of a directory inside a container.
// It first tries using `ls` via exec, then falls back to reading tar headers.
func (d *DockerClient) ListDir(ctx context.Context, containerID, path string) ([]model.FileNode, error) {
	path, err := ValidatePath(path)
	if err != nil {
		return nil, err
	}

	nodes, err := d.listDirExec(ctx, containerID, path)
	if err != nil || len(nodes) == 0 {
		// Fallback: use CopyFromContainer and read tar headers
		nodes, err = d.listDirTar(ctx, containerID, path)
		if err != nil {
			return nil, fmt.Errorf("listing directory %s: %w", path, err)
		}
	}

	sortNodes(nodes)
	return nodes, nil
}

// listDirExec uses ContainerExecCreate/ExecAttach to run ls inside the container.
func (d *DockerClient) listDirExec(ctx context.Context, containerID, path string) ([]model.FileNode, error) {
	execConfig := container.ExecOptions{
		Cmd:          []string{"ls", "-la", "--time-style=full-iso", "--", path},
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := d.cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		return nil, fmt.Errorf("exec create: %w", err)
	}

	resp, err := d.cli.ContainerExecAttach(ctx, execID.ID, container.ExecAttachOptions{})
	if err != nil {
		return nil, fmt.Errorf("exec attach: %w", err)
	}
	defer resp.Close()

	output, err := io.ReadAll(resp.Reader)
	if err != nil {
		return nil, fmt.Errorf("reading exec output: %w", err)
	}

	// Check exit code — poll until exec completes to avoid race between
	// stream close and metadata update in the Docker API.
	inspectResp, err := d.cli.ContainerExecInspect(ctx, execID.ID)
	if err != nil {
		return nil, fmt.Errorf("exec inspect: %w", err)
	}
	for inspectResp.Running {
		time.Sleep(50 * time.Millisecond)
		inspectResp, err = d.cli.ContainerExecInspect(ctx, execID.ID)
		if err != nil {
			return nil, fmt.Errorf("exec inspect: %w", err)
		}
	}
	if inspectResp.ExitCode != 0 {
		return nil, fmt.Errorf("ls exited with code %d", inspectResp.ExitCode)
	}

	return parseLsOutput(output, path)
}

// parseLsOutput parses the raw output from ls -la --time-style=full-iso.
// Docker exec output uses a multiplexed stream with 8-byte headers per frame.
func parseLsOutput(raw []byte, dirPath string) ([]model.FileNode, error) {
	cleaned := demuxExecOutput(raw)

	lines := strings.Split(string(cleaned), "\n")
	var nodes []model.FileNode

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}

		node, err := parseLsLine(line, dirPath)
		if err != nil {
			continue // skip unparseable lines
		}

		// Skip . and ..
		if node.Name == "." || node.Name == ".." {
			continue
		}

		nodes = append(nodes, *node)
	}

	return nodes, nil
}

// lsLineRegex matches lines from ls -la --time-style=full-iso
// Example: drwxr-xr-x 2 root root 4096 2024-01-15 10:30:00.000000000 +0000 conf.d
var lsLineRegex = regexp.MustCompile(
	`^([dlcbps-][rwxsStT-]{9})\S*\s+` + // permissions (+ optional ACL indicators)
		`\d+\s+` + // link count
		`\S+\s+` + // owner
		`\S+\s+` + // group
		`(\d+)\s+` + // size
		`(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+` + // date+time
		`([+-]\d{4})\s+` + // timezone
		`(.+)$`, // name (possibly with -> target)
)

// parseLsLine parses a single line of ls -la --time-style=full-iso output.
func parseLsLine(line, dirPath string) (*model.FileNode, error) {
	matches := lsLineRegex.FindStringSubmatch(line)
	if matches == nil {
		return nil, fmt.Errorf("cannot parse ls line: %s", line)
	}

	perms := matches[1]
	sizeStr := matches[2]
	dateTimeStr := matches[3]
	tzStr := matches[4]
	nameField := matches[5]

	size, _ := strconv.ParseInt(sizeStr, 10, 64)

	// Parse timestamp
	timeStr := dateTimeStr + " " + tzStr
	// Truncate nanoseconds for parsing compatibility
	if idx := strings.Index(timeStr, "."); idx != -1 {
		spaceIdx := strings.Index(timeStr[idx:], " ")
		if spaceIdx != -1 {
			timeStr = timeStr[:idx] + timeStr[idx+spaceIdx:]
		}
	}
	modified, _ := time.Parse("2006-01-02 15:04:05 -0700", timeStr)

	// Determine type from the first character of permissions
	var nodeType string
	switch perms[0] {
	case 'd':
		nodeType = "directory"
	case 'l':
		nodeType = "symlink"
	default:
		nodeType = "file"
	}

	// Parse name and symlink target
	name := nameField
	var linkTarget string
	if nodeType == "symlink" {
		parts := strings.SplitN(nameField, " -> ", 2)
		if len(parts) == 2 {
			name = parts[0]
			linkTarget = parts[1]
		}
	}

	nodePath := filepath.Join(dirPath, name)
	if dirPath == "/" {
		nodePath = "/" + name
	}

	return &model.FileNode{
		Name:        name,
		Path:        nodePath,
		Type:        nodeType,
		Size:        size,
		Modified:    modified,
		Permissions: perms,
		LinkTarget:  linkTarget,
	}, nil
}

// listDirTar uses CopyFromContainer to list directory contents via tar headers.
// This is the fallback for containers without ls (e.g., FROM scratch).
func (d *DockerClient) listDirTar(ctx context.Context, containerID, path string) ([]model.FileNode, error) {
	reader, _, err := d.cli.CopyFromContainer(ctx, containerID, path)
	if err != nil {
		return nil, fmt.Errorf("copy from container: %w", err)
	}
	defer reader.Close()

	tr := tar.NewReader(reader)
	var nodes []model.FileNode
	seen := make(map[string]bool)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading tar: %w", err)
		}

		// The first entry is the directory itself; skip it
		name := strings.TrimPrefix(header.Name, filepath.Base(path)+"/")
		if name == "" || name == filepath.Base(path) {
			continue
		}

		// Only include direct children (one level deep)
		parts := strings.Split(strings.TrimSuffix(name, "/"), "/")
		if len(parts) > 1 {
			// This is a nested entry; only register the top-level directory
			name = parts[0]
		}

		if seen[name] {
			continue
		}
		seen[name] = true

		var nodeType string
		switch header.Typeflag {
		case tar.TypeDir:
			nodeType = "directory"
		case tar.TypeSymlink:
			nodeType = "symlink"
		default:
			nodeType = "file"
		}

		// For nested entries, mark as directory
		if len(parts) > 1 {
			nodeType = "directory"
		}

		nodePath := filepath.Join(path, name)
		if path == "/" {
			nodePath = "/" + name
		}

		nodes = append(nodes, model.FileNode{
			Name:        name,
			Path:        nodePath,
			Type:        nodeType,
			Size:        header.Size,
			Modified:    header.ModTime,
			Permissions: header.FileInfo().Mode().String(),
			LinkTarget:  header.Linkname,
		})
	}

	return nodes, nil
}

// sortNodes sorts file nodes: directories first, then files, alphabetically.
func sortNodes(nodes []model.FileNode) {
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Type == "directory" && nodes[j].Type != "directory" {
			return true
		}
		if nodes[i].Type != "directory" && nodes[j].Type == "directory" {
			return false
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
}

// StatPath returns metadata about a file or directory inside a container.
func (d *DockerClient) StatPath(ctx context.Context, containerID, path string) (*model.FileNode, error) {
	path, err := ValidatePath(path)
	if err != nil {
		return nil, err
	}

	stat, err := d.cli.ContainerStatPath(ctx, containerID, path)
	if err != nil {
		return nil, fmt.Errorf("stat %s: %w", path, err)
	}

	nodeType := "file"
	if stat.Mode.IsDir() {
		nodeType = "directory"
	} else if stat.Mode&0o120000 != 0 {
		nodeType = "symlink"
	}

	return &model.FileNode{
		Name:        stat.Name,
		Path:        path,
		Type:        nodeType,
		Size:        stat.Size,
		Modified:    stat.Mtime,
		Permissions: stat.Mode.String(),
		LinkTarget:  stat.LinkTarget,
	}, nil
}

// ReadFile reads a file from a container and returns its content as a stream.
// Returns an error if the path is a directory.
func (d *DockerClient) ReadFile(ctx context.Context, containerID, path string) (io.ReadCloser, int64, error) {
	path, err := ValidatePath(path)
	if err != nil {
		return nil, 0, err
	}

	// Check that it's not a directory
	stat, err := d.cli.ContainerStatPath(ctx, containerID, path)
	if err != nil {
		return nil, 0, fmt.Errorf("stat %s: %w", path, err)
	}
	if stat.Mode.IsDir() {
		return nil, 0, fmt.Errorf("path is a directory: %s", path)
	}

	reader, _, err := d.cli.CopyFromContainer(ctx, containerID, path)
	if err != nil {
		return nil, 0, fmt.Errorf("copy from container: %w", err)
	}

	// CopyFromContainer returns a tar stream; extract the single file
	tr := tar.NewReader(reader)
	header, err := tr.Next()
	if err != nil {
		reader.Close()
		return nil, 0, fmt.Errorf("reading tar header: %w", err)
	}

	// Wrap the tar reader so that closing it also closes the underlying reader
	return &tarFileReader{Reader: tr, closer: reader}, header.Size, nil
}

// tarFileReader wraps a tar reader to expose it as io.ReadCloser,
// closing the underlying container copy stream when done.
type tarFileReader struct {
	*tar.Reader
	closer io.Closer
}

func (r *tarFileReader) Read(p []byte) (int, error) {
	return r.Reader.Read(p)
}

func (r *tarFileReader) Close() error {
	return r.closer.Close()
}

// DeletePath deletes a file or directory inside a container using rm -rf.
// It never allows deleting the root path "/".
func (d *DockerClient) DeletePath(ctx context.Context, containerID, path string) error {
	path, err := ValidatePath(path)
	if err != nil {
		return err
	}

	if path == "/" {
		return fmt.Errorf("cannot delete root path")
	}

	execConfig := container.ExecOptions{
		Cmd:          []string{"rm", "-rf", "--", path},
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := d.cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		return fmt.Errorf("exec create: %w", err)
	}

	resp, err := d.cli.ContainerExecAttach(ctx, execID.ID, container.ExecAttachOptions{})
	if err != nil {
		return fmt.Errorf("exec attach: %w", err)
	}
	defer resp.Close()

	// Read all output to ensure the command completes
	_, _ = io.ReadAll(resp.Reader)

	// Poll until exec completes to avoid race between stream close and
	// metadata update in the Docker API.
	inspectResp, err := d.cli.ContainerExecInspect(ctx, execID.ID)
	if err != nil {
		return fmt.Errorf("exec inspect: %w", err)
	}
	for inspectResp.Running {
		time.Sleep(50 * time.Millisecond)
		inspectResp, err = d.cli.ContainerExecInspect(ctx, execID.ID)
		if err != nil {
			return fmt.Errorf("exec inspect: %w", err)
		}
	}
	if inspectResp.ExitCode != 0 {
		return fmt.Errorf("rm exited with code %d", inspectResp.ExitCode)
	}

	return nil
}

// ArchiveDir returns a tar stream of a directory from a container.
// The caller is responsible for closing the returned reader.
func (d *DockerClient) ArchiveDir(ctx context.Context, containerID, path string) (io.ReadCloser, error) {
	path, err := ValidatePath(path)
	if err != nil {
		return nil, err
	}

	reader, _, err := d.cli.CopyFromContainer(ctx, containerID, path)
	if err != nil {
		return nil, fmt.Errorf("copy from container: %w", err)
	}

	return reader, nil
}

// SearchFiles searches for files inside a container by filename or content.
// If searchContent is true, it uses grep to search file contents.
// Results are limited to the first 100 matches with a 10-second timeout.
func (d *DockerClient) SearchFiles(ctx context.Context, containerID, rootPath, query string, searchContent bool) ([]model.FileNode, error) {
	rootPath, err := ValidatePath(rootPath)
	if err != nil {
		return nil, err
	}

	query = sanitizeSearchQuery(query)
	if query == "" {
		return nil, fmt.Errorf("search query is empty after sanitization")
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var cmd []string
	if searchContent {
		cmd = []string{"grep", "-rl", "--include=*", "--", query, rootPath}
	} else {
		cmd = []string{"find", rootPath, "-maxdepth", "10", "-name", "*" + query + "*", "-type", "f"}
	}

	execConfig := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := d.cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		return nil, fmt.Errorf("exec create: %w", err)
	}

	resp, err := d.cli.ContainerExecAttach(ctx, execID.ID, container.ExecAttachOptions{})
	if err != nil {
		return nil, fmt.Errorf("exec attach: %w", err)
	}
	defer resp.Close()

	output, err := io.ReadAll(resp.Reader)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("search timed out")
		}
		return nil, fmt.Errorf("reading exec output: %w", err)
	}

	// Demux the docker exec stream
	cleaned := demuxExecOutput(output)

	lines := strings.Split(strings.TrimSpace(string(cleaned)), "\n")
	var nodes []model.FileNode

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if len(nodes) >= 100 {
			break
		}

		name := filepath.Base(line)
		nodes = append(nodes, model.FileNode{
			Name: name,
			Path: line,
			Type: "file",
		})
	}

	return nodes, nil
}

// sanitizeSearchQuery removes shell-special characters from the query.
func sanitizeSearchQuery(query string) string {
	var result strings.Builder
	for _, r := range query {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '.' || r == '-' || r == '_' || r == ' ' || r == '/' {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// demuxExecOutput extracts stdout from Docker's multiplexed exec stream.
func demuxExecOutput(raw []byte) []byte {
	var cleaned []byte
	buf := raw
	for len(buf) >= 8 {
		streamType := buf[0]
		size := int(buf[4])<<24 | int(buf[5])<<16 | int(buf[6])<<8 | int(buf[7])
		buf = buf[8:]
		if size > len(buf) {
			size = len(buf)
		}
		if streamType == 1 { // stdout
			cleaned = append(cleaned, buf[:size]...)
		}
		buf = buf[size:]
	}
	if len(cleaned) == 0 {
		cleaned = raw
	}
	return cleaned
}

// WriteFile writes content to a file inside a container using CopyToContainer.
func (d *DockerClient) WriteFile(ctx context.Context, containerID, path string, content io.Reader, size int64) error {
	path, err := ValidatePath(path)
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	base := filepath.Base(path)

	// Create a tar archive with a single file
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	header := &tar.Header{
		Name:    base,
		Size:    size,
		Mode:    0644,
		ModTime: time.Now(),
	}

	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("writing tar header: %w", err)
	}

	if _, err := io.Copy(tw, content); err != nil {
		return fmt.Errorf("writing tar content: %w", err)
	}

	if err := tw.Close(); err != nil {
		return fmt.Errorf("closing tar writer: %w", err)
	}

	return d.cli.CopyToContainer(ctx, containerID, dir, &buf, container.CopyToContainerOptions{
		AllowOverwriteDirWithFile: true,
	})
}
