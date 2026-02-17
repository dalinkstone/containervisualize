// Container Visualize — Toolbar

class Toolbar {
    constructor(headerEl) {
        this.header = headerEl;
        this.badge = document.getElementById('container-badge');
        this.refreshBtn = document.getElementById('btn-refresh');
        this.uploadBtn = document.getElementById('btn-upload');
        this.downloadBtn = document.getElementById('btn-download');
    }

    setContainerInfo(info) {
        if (!this.badge) return;
        const statusColor = info.status === 'running' ? 'var(--success)' : 'var(--danger)';
        this.badge.innerHTML =
            `<span style="color:${statusColor}">\u25CF</span> ` +
            `${info.name} ` +
            `<span style="color:var(--text-secondary)">${info.image}</span>`;
    }

    onRefresh(callback) {
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', callback);
        }
    }

    onUpload(callback) {
        if (this.uploadBtn) {
            this.uploadBtn.addEventListener('click', callback);
        }
    }

    onDownload(callback) {
        if (this.downloadBtn) {
            this.downloadBtn.addEventListener('click', callback);
        }
    }
}
