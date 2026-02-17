package docker

import (
	"context"
	"fmt"

	"github.com/docker/docker/client"
)

// DockerClient wraps the official Docker SDK client.
type DockerClient struct {
	cli *client.Client
}

// NewDockerClient creates a new Docker client. If dockerHost is empty,
// the client is configured from environment variables (DOCKER_HOST, etc.).
func NewDockerClient(dockerHost string) (*DockerClient, error) {
	var opts []client.Opt
	opts = append(opts, client.WithAPIVersionNegotiation())

	if dockerHost != "" {
		opts = append(opts, client.WithHost(dockerHost))
	} else {
		opts = append(opts, client.FromEnv)
	}

	cli, err := client.NewClientWithOpts(opts...)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}

	return &DockerClient{cli: cli}, nil
}

// Ping verifies connectivity to the Docker daemon.
func (d *DockerClient) Ping(ctx context.Context) error {
	_, err := d.cli.Ping(ctx)
	if err != nil {
		return fmt.Errorf("docker ping failed: %w", err)
	}
	return nil
}

// Close closes the underlying Docker client connection.
func (d *DockerClient) Close() error {
	return d.cli.Close()
}
