// Container Visualize — API wrapper

const api = {
    async _fetch(url, options) {
        const resp = await fetch(url, options);
        if (!resp.ok) {
            let message = `HTTP ${resp.status}`;
            try {
                const body = await resp.json();
                if (body.error) {
                    message = body.error;
                }
            } catch {
                // response wasn't JSON, use status text
                message = resp.statusText || message;
            }
            throw new Error(message);
        }
        return resp;
    },

    async getContainer() {
        const resp = await this._fetch('/api/container');
        return resp.json();
    },

    async getTree(path) {
        const params = new URLSearchParams({ path: path || '/' });
        const resp = await this._fetch(`/api/tree?${params}`);
        return resp.json();
    },

    async getFile(path) {
        const resp = await this._fetch(`/api/file?${new URLSearchParams({ path })}`);
        const contentType = resp.headers.get('Content-Type') || '';
        const size = parseInt(resp.headers.get('Content-Length') || '0', 10);

        if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('javascript')) {
            const content = await resp.text();
            return { content, contentType, size };
        }
        const blob = await resp.blob();
        return { content: blob, contentType, size };
    },

    async updateFile(path, content) {
        await this._fetch(`/api/file?${new URLSearchParams({ path })}`, {
            method: 'PUT',
            body: content,
        });
    },

    async uploadFile(dirPath, file) {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await this._fetch(`/api/file?${new URLSearchParams({ path: dirPath })}`, {
            method: 'POST',
            body: formData,
        });
        return resp.json();
    },

    async deleteFile(path) {
        const resp = await this._fetch(`/api/file?${new URLSearchParams({ path })}`, {
            method: 'DELETE',
        });
        return resp.json();
    },

    downloadArchive(path) {
        const url = `/api/archive?${new URLSearchParams({ path })}`;
        window.open(url, '_blank');
    },

    downloadFile(path) {
        const url = `/api/archive?${new URLSearchParams({ path })}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop();
        document.body.appendChild(a);
        a.click();
        a.remove();
    },
};
