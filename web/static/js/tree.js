// Container Visualize — File tree component

class FileTree {
    constructor(container) {
        this.container = container;
        this.selectedPath = null;
        this.expandedDirs = new Set();
        this._handleClick = this._handleClick.bind(this);
        this.container.addEventListener('click', this._handleClick);
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
            await this._toggleDir(item, path);
        } else {
            this._selectFile(item, path);
        }
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
