// Container Visualize — Editor/viewer panel

class EditorPanel {
    constructor(container) {
        this.container = container;
        this.currentPath = null;
    }

    openFile(path, content, contentType) {
        this.currentPath = path;
        this.container.innerHTML = '';

        // Breadcrumb
        const breadcrumb = document.createElement('div');
        breadcrumb.className = 'editor-breadcrumb';
        const parts = path.split('/').filter(Boolean);
        const fragments = [];
        fragments.push('/');
        for (let i = 0; i < parts.length; i++) {
            fragments.push(`<span class="path-sep">/</span>${parts[i]}`);
        }
        breadcrumb.innerHTML = fragments.join('');
        this.container.appendChild(breadcrumb);

        // Content area
        const contentEl = document.createElement('div');
        contentEl.className = 'editor-content';

        if (contentType.startsWith('image/')) {
            // Image preview
            const img = document.createElement('img');
            if (content instanceof Blob) {
                img.src = URL.createObjectURL(content);
                img.onload = () => URL.revokeObjectURL(img.src);
            }
            img.alt = path.split('/').pop();
            contentEl.appendChild(img);
        } else if (typeof content === 'string') {
            // Text content
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = content;
            pre.appendChild(code);
            contentEl.appendChild(pre);
        } else {
            // Binary file
            const size = content instanceof Blob ? content.size : 0;
            const notice = document.createElement('div');
            notice.className = 'binary-notice';
            notice.innerHTML = `<p>Binary file (${this._humanSize(size)})</p>` +
                `<a href="/api/file?path=${encodeURIComponent(path)}" download>Download file</a>`;
            contentEl.appendChild(notice);
        }

        this.container.appendChild(contentEl);
    }

    clear() {
        this.currentPath = null;
        this.container.innerHTML = '<div class="empty-state"><p>Select a file to view its contents</p></div>';
    }

    _humanSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
}
