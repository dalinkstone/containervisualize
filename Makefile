VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY := containervisualize
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: build test test-integration lint clean release fmt dev

build:
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY) ./cmd/containervisualize

test:
	go test -v -race -count=1 ./...

test-integration:
	go test -v -race -tags=integration -count=1 ./...

lint:
	golangci-lint run ./...

clean:
	rm -rf bin/

release:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-amd64 ./cmd/containervisualize
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-arm64 ./cmd/containervisualize
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-darwin-arm64 ./cmd/containervisualize
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-darwin-amd64 ./cmd/containervisualize
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-windows-amd64.exe ./cmd/containervisualize

fmt:
	gofmt -s -w .

dev:
	go run ./cmd/containervisualize --container $(CONTAINER) --verbose
