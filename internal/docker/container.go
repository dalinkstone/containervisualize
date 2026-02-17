package docker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dalinkstone/containervisualize/internal/model"
)

// GetContainerInfo returns metadata about a running container.
func (d *DockerClient) GetContainerInfo(ctx context.Context, containerID string) (*model.ContainerInfo, error) {
	inspect, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("inspecting container %s: %w", containerID, err)
	}

	if !inspect.State.Running {
		return nil, fmt.Errorf("container %s is not running (status: %s)", containerID, inspect.State.Status)
	}

	name := strings.TrimPrefix(inspect.Name, "/")

	platform := inspect.Platform
	if platform == "" && inspect.Config != nil {
		// Fall back to OS/arch from image labels if available
		platform = "linux"
	}

	created, _ := time.Parse(time.RFC3339Nano, inspect.Created)

	info := &model.ContainerInfo{
		ID:       inspect.ID[:12],
		Name:     name,
		Image:    inspect.Config.Image,
		Status:   inspect.State.Status,
		Created:  created,
		Platform: platform,
	}

	return info, nil
}
