FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION}" -o /containervisualize ./cmd/containervisualize

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /containervisualize /usr/local/bin/containervisualize

ENTRYPOINT ["containervisualize"]
