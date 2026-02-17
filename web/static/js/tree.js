// Container Visualize — File tree component with context menu

class FileTree {
    constructor(container) {
        this.container = container;
        this.selectedPath = null;
        this.selectedType = null;
        this.expandedDirs = new Set();
        this._handleClick = this._handleClick.bind(this);
        this._handleContextMenu = this._handleContextMenu.bind(this);
        this.container.addEventListener('click', this._handleClick);
        this.container.addEventListener('contextmenu', this._handleContextMenu);

        // Dismiss context menu on click outside or Escape
        document.addEventListener('click', () => this._dismissContextMenu());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._dismissContextMenu();
        });

        // Drag and drop support
        this._setupDragDrop();
    }

    async loadRoot() {
        this.container.innerHTML = '';
        try {
            const nodes = await api.getTree('/');
            for (const node of nodes) {
                this._renderNode(node, this.container, 0);
            }
        } catch (err) {
            this.container.innerHTML = `<div class="tree-loading">Error: ${err.message}</div>`;
        }
    }

    _renderNode(node, parentEl, depth) {
        const item = document.createElement('div');
        item.className = 'tree-item';
        if (this.selectedPath === node.path) {
            item.classList.add('selected');
        }
        item.style.paddingLeft = `${10 + depth * 16}px`;
        item.dataset.path = node.path;
        item.dataset.type = node.type;

        // Arrow (directories only)
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        if (node.type === 'directory') {
            arrow.textContent = '\u25B6';
            if (this.expandedDirs.has(node.path)) {
                arrow.classList.add('expanded');
            }
        } else {
            arrow.classList.add('hidden');
        }
        item.appendChild(arrow);

        // Icon
        const icon = document.createElement('span');
        icon.className = 'icon';
        if (node.type === 'directory') {
            icon.textContent = '\uD83D\uDCC1';
        } else if (node.type === 'symlink') {
            icon.textContent = '\uD83D\uDD17';
        } else {
            icon.textContent = '\uD83D\uDCC4';
        }
        item.appendChild(icon);

        // Name
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = node.name;
        item.appendChild(name);

        // Symlink target
        if (node.type === 'symlink' && node.linkTarget) {
            const link = document.createElement('span');
            link.className = 'link-target';
            link.textContent = `\u2192 ${node.linkTarget}`;
            item.appendChild(link);
        }

        // File size
        if (node.type === 'file' && node.size > 0) {
            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = this._humanSize(node.size);
            item.appendChild(meta);
        }

        parentEl.appendChild(item);

        // Children container for directories
        if (node.type === 'directory') {
            const children = document.createElement('div');
            children.className = 'tree-children';
            children.dataset.path = node.path;
            if (this.expandedDirs.has(node.path)) {
                children.classList.add('expanded');
            }
            parentEl.appendChild(children);
        }
    }

    async _handleClick(e) {
        const item = e.target.closest('.tree-item');
        if (!item) return;

        const path = item.dataset.path;
        const type = item.dataset.type;

        if (type === 'directory') {
            this.selectedPath = path;
            this.selectedType = 'directory';
            await this._toggleDir(item, path);
        } else {
            this.selectedType = 'file';
            this._selectFile(item, path);
        }
    }

    _handleContextMenu(e) {
        const item = e.target.closest('.tree-item');
        if (!item) return;

        e.preventDefault();
        e.stopPropagation();

        const path = item.dataset.path;
        const type = item.dataset.type;

        this._showContextMenu(e.clientX, e.clientY, path, type);
    }

    _showContextMenu(x, y, path, type) {
        this._dismissContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'tree-context-menu';

        const items = [];

        if (type === 'directory') {
            items.push({ label: 'New File', action: () => this._contextNewFile(path) });
            items.push({ label: 'Upload File Here', action: () => this._contextUpload(path) });
            items.push({ divider: true });
            items.push({ label: 'Download as Archive', action: () => api.downloadArchive(path) });
            items.push({ divider: true });
            items.push({ label: 'Delete', action: () => this._contextDelete(path), danger: true });
            items.push({ divider: true });
            items.push({ label: 'Copy Path', action: () => this._contextCopyPath(path) });
        } else {
            items.push({ label: 'Download', action: () => api.downloadFile(path) });
            items.push({ divider: true });
            items.push({ label: 'Delete', action: () => this._contextDelete(path), danger: true });
            items.push({ divider: true });
            items.push({ label: 'Copy Path', action: () => this._contextCopyPath(path) });
        }

        for (const item of items) {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'context-menu-divider';
                menu.appendChild(divider);
            } else {
                const btn = document.createElement('button');
                btn.className = 'context-menu-item';
                if (item.danger) btn.classList.add('danger');
                btn.textContent = item.label;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._dismissContextMenu();
                    item.action();
                });
                menu.appendChild(btn);
            }
        }

        document.body.appendChild(menu);

        // Position menu, ensuring it stays within viewport
        const rect = menu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        menu.style.left = `${Math.min(x, maxX)}px`;
        menu.style.top = `${Math.min(y, maxY)}px`;
    }

    _dismissContextMenu() {
        const existing = document.getElementById('tree-context-menu');
        if (existing) existing.remove();
    }

    async _contextNewFile(dirPath) {
        const filename = prompt('Enter filename:');
        if (!filename) return;

        const filePath = dirPath.endsWith('/') ? dirPath + filename : dirPath + '/' + filename;
        try {
            await api.updateFile(filePath, '');
            window.showToast(`Created ${filename}`, 'success');
            await this._refreshDir(dirPath);
        } catch (err) {
            window.showToast(`Failed to create file: ${err.message}`, 'error');
        }
    }

    _contextUpload(dirPath) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', async () => {
            for (const file of input.files) {
                try {
                    await api.uploadFile(dirPath, file);
                    window.showToast(`Uploaded ${file.name}`, 'success');
                } catch (err) {
                    window.showToast(`Upload failed: ${err.message}`, 'error');
                }
            }
            await this._refreshDir(dirPath);
        });
        input.click();
    }

    _contextDelete(path) {
        // Dispatch a custom event so app.js can show the confirmation dialog
        this.container.dispatchEvent(new CustomEvent('file-delete-request', {
            bubbles: true,
            detail: { path },
        }));
    }

    _contextCopyPath(path) {
        navigator.clipboard.writeText(path).then(
            () => window.showToast('Path copied to clipboard', 'info'),
            () => window.showToast('Failed to copy path', 'error')
        );
    }

    async _refreshDir(dirPath) {
        // Find the children container for this directory and reload it
        const childrenEl = this.container.querySelector(`.tree-children[data-path="${CSS.escape(dirPath)}"]`);
        if (childrenEl && this.expandedDirs.has(dirPath)) {
            const parentItem = childrenEl.previousElementSibling;
            const depth = parentItem ? this._getDepth(parentItem) : 0;
            try {
                const nodes = await api.getTree(dirPath);
                childrenEl.innerHTML = '';
                for (const node of nodes) {
                    this._renderNode(node, childrenEl, depth + 1);
                }
                if (nodes.length === 0) {
                    childrenEl.innerHTML = '<div class="tree-loading">Empty directory</div>';
                }
            } catch (err) {
                childrenEl.innerHTML = `<div class="tree-loading">Error: ${err.message}</div>`;
            }
        } else {
            // Fallback: full tree refresh
            await this.refresh();
        }
    }

    removeNode(path) {
        // Remove the tree item and its children container (if directory)
        const item = this.container.querySelector(`.tree-item[data-path="${CSS.escape(path)}"]`);
        if (item) {
            const children = item.nextElementSibling;
            if (children && children.classList.contains('tree-children')) {
                children.remove();
            }
            item.remove();
        }
        this.expandedDirs.delete(path);
        if (this.selectedPath === path) {
            this.selectedPath = null;
            this.selectedType = null;
        }
    }

    _setupDragDrop() {
        this.container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.container.classList.add('drag-over');

            // Highlight the directory being hovered
            const item = e.target.closest('.tree-item');
            this._clearDropHighlight();
            if (item && item.dataset.type === 'directory') {
                item.classList.add('drop-target');
            }
        });

        this.container.addEventListener('dragleave', (e) => {
            // Only remove if we're actually leaving the container
            if (!this.container.contains(e.relatedTarget)) {
                this.container.classList.remove('drag-over');
                this._clearDropHighlight();
            }
        });

        this.container.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.container.classList.remove('drag-over');

            // Determine target directory
            const item = e.target.closest('.tree-item');
            let targetDir = '/';
            if (item) {
                if (item.dataset.type === 'directory') {
                    targetDir = item.dataset.path;
                } else {
                    // Dropped on a file — use its parent directory
                    const parts = item.dataset.path.split('/');
                    parts.pop();
                    targetDir = parts.join('/') || '/';
                }
            }
            this._clearDropHighlight();

            const files = e.dataTransfer.files;
            if (files.length === 0) return;

            for (const file of files) {
                try {
                    await api.uploadFile(targetDir, file);
                    window.showToast(`Uploaded ${file.name}`, 'success');
                } catch (err) {
                    window.showToast(`Upload failed: ${err.message}`, 'error');
                }
            }
            await this._refreshDir(targetDir);
        });
    }

    _clearDropHighlight() {
        const prev = this.container.querySelector('.drop-target');
        if (prev) prev.classList.remove('drop-target');
    }

    getSelectedDir() {
        if (this.selectedType === 'directory' && this.selectedPath) {
            return this.selectedPath;
        }
        if (this.selectedPath) {
            // Return parent directory of selected file
            const parts = this.selectedPath.split('/');
            parts.pop();
            return parts.join('/') || '/';
        }
        return '/';
    }

    async _toggleDir(item, path) {
        const arrow = item.querySelector('.arrow');
        const children = item.nextElementSibling;
        if (!children || !children.classList.contains('tree-children')) return;

        if (this.expandedDirs.has(path)) {
            // Collapse
            this.expandedDirs.delete(path);
            children.classList.remove('expanded');
            arrow.classList.remove('expanded');
        } else {
            // Expand
            this.expandedDirs.add(path);
            arrow.classList.add('expanded');
            children.classList.add('expanded');

            // Load children if empty
            if (children.children.length === 0) {
                children.innerHTML = '<div class="tree-loading">Loading...</div>';
                try {
                    const nodes = await api.getTree(path);
                    children.innerHTML = '';
                    const depth = this._getDepth(item);
                    for (const node of nodes) {
                        this._renderNode(node, children, depth + 1);
                    }
                    if (nodes.length === 0) {
                        children.innerHTML = '<div class="tree-loading">Empty directory</div>';
                    }
                } catch (err) {
                    children.innerHTML = `<div class="tree-loading">Error: ${err.message}</div>`;
                }
            }
        }
    }

    _selectFile(item, path) {
        // Remove previous selection
        const prev = this.container.querySelector('.tree-item.selected');
        if (prev) prev.classList.remove('selected');

        item.classList.add('selected');
        this.selectedPath = path;
        this.selectedType = item.dataset.type;

        this.container.dispatchEvent(new CustomEvent('file-select', {
            bubbles: true,
            detail: { path },
        }));
    }

    _getDepth(item) {
        const paddingLeft = parseInt(item.style.paddingLeft, 10) || 10;
        return Math.round((paddingLeft - 10) / 16);
    }

    async refresh() {
        const expanded = new Set(this.expandedDirs);
        this.expandedDirs = new Set();
        await this.loadRoot();

        // Re-expand previously expanded directories
        for (const dir of expanded) {
            const item = this.container.querySelector(`.tree-item[data-path="${CSS.escape(dir)}"]`);
            if (item) {
                await this._toggleDir(item, dir);
            }
        }
    }

    _humanSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
}
