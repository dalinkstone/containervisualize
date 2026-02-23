//go:build integration

package docker

import (
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

var (
	testClient      *DockerClient
	testContainerID string
)

func TestMain(m *testing.M) {
	ctx := context.Background()

	req := testcontainers.ContainerRequest{
		Image:        "nginx:alpine",
		ExposedPorts: []string{"80/tcp"},
		WaitingFor:   wait.ForHTTP("/"),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		panic("failed to start test container: " + err.Error())
	}

	testContainerID = container.GetContainerID()

	testClient, err = NewDockerClient("")
	if err != nil {
		panic("failed to create docker client: " + err.Error())
	}

	code := m.Run()

	container.Terminate(ctx)
	testClient.Close()

	os.Exit(code)
}

func TestListDir_Root(t *testing.T) {
	ctx := context.Background()

	nodes, err := testClient.ListDir(ctx, testContainerID, "/")
	if err != nil {
		t.Fatalf("ListDir(/) error: %v", err)
	}

	if len(nodes) == 0 {
		t.Fatal("expected non-empty root directory listing")
	}

	// Check for common directories
	found := map[string]bool{"etc": false, "var": false, "usr": false}
	for _, n := range nodes {
		if _, ok := found[n.Name]; ok {
			found[n.Name] = true
		}
	}
	for name, ok := range found {
		if !ok {
			t.Errorf("expected to find /%s in root listing", name)
		}
	}
}

func TestListDir_Nested(t *testing.T) {
	ctx := context.Background()

	nodes, err := testClient.ListDir(ctx, testContainerID, "/etc/nginx")
	if err != nil {
		t.Fatalf("ListDir(/etc/nginx) error: %v", err)
	}

	found := false
	for _, n := range nodes {
		if n.Name == "nginx.conf" {
			found = true
			if n.Type != "file" {
				t.Errorf("nginx.conf type = %q, want file", n.Type)
			}
			break
		}
	}
	if !found {
		t.Error("expected to find nginx.conf in /etc/nginx")
	}
}

func TestReadFile(t *testing.T) {
	ctx := context.Background()

	reader, size, err := testClient.ReadFile(ctx, testContainerID, "/etc/nginx/nginx.conf")
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	defer reader.Close()

	if size <= 0 {
		t.Errorf("expected positive file size, got %d", size)
	}

	content, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("reading content: %v", err)
	}

	if !strings.Contains(string(content), "worker_processes") {
		t.Error("expected nginx.conf to contain 'worker_processes'")
	}
}

func TestWriteFile(t *testing.T) {
	ctx := context.Background()
	testContent := "hello from integration test"

	err := testClient.WriteFile(ctx, testContainerID, "/tmp/integration-test.txt",
		bytes.NewReader([]byte(testContent)), int64(len(testContent)))
	if err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	// Read it back
	reader, _, err := testClient.ReadFile(ctx, testContainerID, "/tmp/integration-test.txt")
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	defer reader.Close()

	content, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("reading content: %v", err)
	}

	if string(content) != testContent {
		t.Errorf("content = %q, want %q", string(content), testContent)
	}
}

func TestDeletePath(t *testing.T) {
	ctx := context.Background()
	testContent := "to be deleted"

	err := testClient.WriteFile(ctx, testContainerID, "/tmp/delete-me.txt",
		bytes.NewReader([]byte(testContent)), int64(len(testContent)))
	if err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	// Verify the file exists
	_, err = testClient.StatPath(ctx, testContainerID, "/tmp/delete-me.txt")
	if err != nil {
		t.Fatalf("StatPath before delete error: %v", err)
	}

	// Delete it
	err = testClient.DeletePath(ctx, testContainerID, "/tmp/delete-me.txt")
	if err != nil {
		t.Fatalf("DeletePath error: %v", err)
	}

	// Verify it's gone
	_, err = testClient.StatPath(ctx, testContainerID, "/tmp/delete-me.txt")
	if err == nil {
		t.Error("expected StatPath to fail after delete, but it succeeded")
	}
}

func TestSearchFiles(t *testing.T) {
	ctx := context.Background()

	nodes, err := testClient.SearchFiles(ctx, testContainerID, "/etc", "nginx.conf", false)
	if err != nil {
		t.Fatalf("SearchFiles error: %v", err)
	}

	found := false
	for _, n := range nodes {
		if strings.HasSuffix(n.Path, "nginx.conf") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find nginx.conf in search results")
	}
}

func TestDeletePath_RootRejected(t *testing.T) {
	ctx := context.Background()

	err := testClient.DeletePath(ctx, testContainerID, "/")
	if err == nil {
		t.Error("expected DeletePath('/') to fail")
	}
}
