package docker

import (
	"encoding/binary"
	"testing"

	"github.com/dalinkstone/containervisualize/internal/model"
)

func TestValidatePath(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{"root", "/", "/", false},
		{"simple dir", "/etc", "/etc", false},
		{"nested path", "/etc/nginx/nginx.conf", "/etc/nginx/nginx.conf", false},
		{"cleans dotdot", "/var/log/../log/syslog", "/var/log/syslog", false},
		{"cleans trailing slash", "/etc/", "/etc", false},
		{"cleans double slash", "/etc//nginx", "/etc/nginx", false},
		{"relative path rejected", "relative/path", "", true},
		{"dotdot at start", "../etc/passwd", "", true},
		{"dotdot cleans to valid path", "/etc/../../root", "/root", false},
		{"null byte rejected", "/etc/\x00passwd", "", true},
		{"empty string rejected", "", "", true},
		{"bare dotdot", "..", "", true},
		{"dot only", ".", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ValidatePath(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidatePath(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("ValidatePath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseLsLine(t *testing.T) {
	tests := []struct {
		name       string
		line       string
		dirPath    string
		wantName   string
		wantType   string
		wantSize   int64
		wantLink   string
		wantErr    bool
	}{
		{
			name:     "regular file",
			line:     "-rw-r--r-- 1 root root 1234 2024-01-15 10:30:00.000000000 +0000 nginx.conf",
			dirPath:  "/etc/nginx",
			wantName: "nginx.conf",
			wantType: "file",
			wantSize: 1234,
		},
		{
			name:     "directory",
			line:     "drwxr-xr-x 2 root root 4096 2024-01-15 10:30:00.000000000 +0000 conf.d",
			dirPath:  "/etc/nginx",
			wantName: "conf.d",
			wantType: "directory",
			wantSize: 4096,
		},
		{
			name:     "symlink",
			line:     "lrwxrwxrwx 1 root root 12 2024-01-15 10:30:00.000000000 +0000 link -> /target",
			dirPath:  "/etc",
			wantName: "link",
			wantType: "symlink",
			wantSize: 12,
			wantLink: "/target",
		},
		{
			name:     "file with spaces in name",
			line:     "-rw-r--r-- 1 root root 100 2024-01-15 10:30:00.000000000 +0000 my file.txt",
			dirPath:  "/tmp",
			wantName: "my file.txt",
			wantType: "file",
			wantSize: 100,
		},
		{
			name:     "very large file",
			line:     "-rw-r--r-- 1 root root 107374182400 2024-01-15 10:30:00.000000000 +0000 bigfile.iso",
			dirPath:  "/data",
			wantName: "bigfile.iso",
			wantType: "file",
			wantSize: 107374182400,
		},
		{
			name:     "root dir path",
			line:     "-rw-r--r-- 1 root root 100 2024-01-15 10:30:00.000000000 +0000 hostname",
			dirPath:  "/",
			wantName: "hostname",
			wantType: "file",
			wantSize: 100,
		},
		{
			name:    "unparseable line",
			line:    "total 42",
			dirPath: "/",
			wantErr: true,
		},
		{
			name:    "empty line",
			line:    "",
			dirPath: "/",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			node, err := parseLsLine(tt.line, tt.dirPath)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseLsLine() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if node.Name != tt.wantName {
				t.Errorf("name = %q, want %q", node.Name, tt.wantName)
			}
			if node.Type != tt.wantType {
				t.Errorf("type = %q, want %q", node.Type, tt.wantType)
			}
			if node.Size != tt.wantSize {
				t.Errorf("size = %d, want %d", node.Size, tt.wantSize)
			}
			if node.LinkTarget != tt.wantLink {
				t.Errorf("linkTarget = %q, want %q", node.LinkTarget, tt.wantLink)
			}
		})
	}
}

func TestSanitizeSearchQuery(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"normal query", "nginx.conf", "nginx.conf"},
		{"alphanumeric", "test123", "test123"},
		{"with spaces", "my file", "my file"},
		{"with dash and underscore", "my-file_name", "my-file_name"},
		{"with path separator", "etc/nginx", "etc/nginx"},
		{"shell special chars stripped", "test;rm -rf /", "testrm -rf /"},
		{"backticks stripped", "`whoami`", "whoami"},
		{"dollar sign stripped", "$HOME", "HOME"},
		{"pipe stripped", "test|cat", "testcat"},
		{"ampersand stripped", "test&bg", "testbg"},
		{"parens stripped", "test()", "test"},
		{"all special chars", "!@#$%^&*()", ""},
		{"empty string", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeSearchQuery(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeSearchQuery(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSortNodes(t *testing.T) {
	nodes := []model.FileNode{
		{Name: "zebra.txt", Type: "file"},
		{Name: "alpha", Type: "directory"},
		{Name: "beta.txt", Type: "file"},
		{Name: "zeta", Type: "directory"},
		{Name: "apple.txt", Type: "file"},
		{Name: "link", Type: "symlink"},
	}

	sortNodes(nodes)

	// Directories should come first, alphabetically
	if nodes[0].Name != "alpha" || nodes[0].Type != "directory" {
		t.Errorf("expected alpha dir first, got %s (%s)", nodes[0].Name, nodes[0].Type)
	}
	if nodes[1].Name != "zeta" || nodes[1].Type != "directory" {
		t.Errorf("expected zeta dir second, got %s (%s)", nodes[1].Name, nodes[1].Type)
	}

	// Then non-directories, alphabetically
	if nodes[2].Name != "apple.txt" {
		t.Errorf("expected apple.txt third, got %s", nodes[2].Name)
	}
	if nodes[3].Name != "beta.txt" {
		t.Errorf("expected beta.txt fourth, got %s", nodes[3].Name)
	}
	if nodes[4].Name != "link" {
		t.Errorf("expected link fifth, got %s", nodes[4].Name)
	}
	if nodes[5].Name != "zebra.txt" {
		t.Errorf("expected zebra.txt sixth, got %s", nodes[5].Name)
	}
}

func TestSortNodes_CaseInsensitive(t *testing.T) {
	nodes := []model.FileNode{
		{Name: "Zebra.txt", Type: "file"},
		{Name: "apple.txt", Type: "file"},
	}

	sortNodes(nodes)

	if nodes[0].Name != "apple.txt" {
		t.Errorf("expected apple.txt first (case-insensitive), got %s", nodes[0].Name)
	}
}

func TestDemuxExecOutput(t *testing.T) {
	t.Run("docker multiplexed stream", func(t *testing.T) {
		// Build a valid Docker multiplexed stream
		// stdout frame: type=1, size=12, payload="hello world\n"
		payload := []byte("hello world\n")
		frame := make([]byte, 8+len(payload))
		frame[0] = 1 // stdout
		binary.BigEndian.PutUint32(frame[4:8], uint32(len(payload)))
		copy(frame[8:], payload)

		got := demuxExecOutput(frame)
		if string(got) != "hello world\n" {
			t.Errorf("demuxExecOutput() = %q, want %q", string(got), "hello world\n")
		}
	})

	t.Run("stderr ignored", func(t *testing.T) {
		// stderr frame: type=2
		payload := []byte("error\n")
		frame := make([]byte, 8+len(payload))
		frame[0] = 2 // stderr
		binary.BigEndian.PutUint32(frame[4:8], uint32(len(payload)))
		copy(frame[8:], payload)

		// stdout frame
		stdoutPayload := []byte("output\n")
		stdoutFrame := make([]byte, 8+len(stdoutPayload))
		stdoutFrame[0] = 1
		binary.BigEndian.PutUint32(stdoutFrame[4:8], uint32(len(stdoutPayload)))
		copy(stdoutFrame[8:], stdoutPayload)

		combined := append(frame, stdoutFrame...)
		got := demuxExecOutput(combined)
		if string(got) != "output\n" {
			t.Errorf("demuxExecOutput() = %q, want %q", string(got), "output\n")
		}
	})

	t.Run("non-multiplexed fallback", func(t *testing.T) {
		// Plain text without Docker framing should be returned as-is
		raw := []byte("plain text output\n")
		got := demuxExecOutput(raw)
		if string(got) != "plain text output\n" {
			t.Errorf("demuxExecOutput() = %q, want %q", string(got), "plain text output\n")
		}
	})

	t.Run("empty input", func(t *testing.T) {
		got := demuxExecOutput([]byte{})
		if len(got) != 0 {
			t.Errorf("demuxExecOutput(empty) = %q, want empty", string(got))
		}
	})
}

func TestParseLsOutput(t *testing.T) {
	t.Run("skips dot entries and total line", func(t *testing.T) {
		// Simulate demuxed output (plain text for simplicity)
		input := []byte("total 64\n" +
			"drwxr-xr-x 2 root root 4096 2024-01-15 10:30:00.000000000 +0000 .\n" +
			"drwxr-xr-x 3 root root 4096 2024-01-15 10:30:00.000000000 +0000 ..\n" +
			"-rw-r--r-- 1 root root 1234 2024-01-15 10:30:00.000000000 +0000 test.txt\n")

		nodes, err := parseLsOutput(input, "/tmp")
		if err != nil {
			t.Fatalf("parseLsOutput() error = %v", err)
		}
		if len(nodes) != 1 {
			t.Fatalf("expected 1 node, got %d", len(nodes))
		}
		if nodes[0].Name != "test.txt" {
			t.Errorf("expected test.txt, got %s", nodes[0].Name)
		}
	})
}

func FuzzValidatePath(f *testing.F) {
	f.Add("/")
	f.Add("/etc")
	f.Add("/etc/nginx/nginx.conf")
	f.Add("../etc/passwd")
	f.Add("relative/path")
	f.Add("")
	f.Add("/etc/../../root")
	f.Add("/tmp/\x00evil")

	f.Fuzz(func(t *testing.T, path string) {
		cleaned, err := ValidatePath(path)
		if err != nil {
			return
		}

		// If validation passes, the result must be absolute
		if cleaned == "" || cleaned[0] != '/' {
			t.Errorf("ValidatePath(%q) returned non-absolute path %q", path, cleaned)
		}

		// Must not contain null bytes
		for _, c := range cleaned {
			if c == 0 {
				t.Errorf("ValidatePath(%q) returned path with null byte", path)
			}
		}

		// Must be idempotent
		cleaned2, err := ValidatePath(cleaned)
		if err != nil {
			t.Errorf("ValidatePath(%q) passed but ValidatePath(%q) failed: %v", path, cleaned, err)
		}
		if cleaned2 != cleaned {
			t.Errorf("ValidatePath not idempotent: %q -> %q -> %q", path, cleaned, cleaned2)
		}
	})
}
