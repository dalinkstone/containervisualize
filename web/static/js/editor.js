// Container Visualize — Editor/viewer panel with CodeMirror 5

class EditorPanel {
    constructor(container, readonly) {
        this.container = container;
        this.currentPath = null;
        this.readonly = readonly || false;
        this.cm = null;
        this.dirty = false;
        this.savedContent = '';
        this.mdPreviewMode = false;
    }

    openFile(path, content, contentType) {
        // If dirty, prompt before switching
        if (this.dirty && this.currentPath) {
            if (!confirm(`You have unsaved changes to ${this.currentPath}. Discard?`)) {
                return false;
            }
        }

        this.currentPath = path;
        this.dirty = false;
        this.mdPreviewMode = false;
        this.cm = null;
        this.container.innerHTML = '';

        // Breadcrumb bar
        const breadcrumbBar = document.createElement('div');
        breadcrumbBar.className = 'editor-breadcrumb';

        const breadcrumbText = document.createElement('span');
        breadcrumbText.className = 'breadcrumb-path';
        const parts = path.split('/').filter(Boolean);
        const fragments = ['/'];
        for (let i = 0; i < parts.length; i++) {
            fragments.push(`<span class="path-sep">/</span>${parts[i]}`);
        }
        breadcrumbText.innerHTML = fragments.join('');
        breadcrumbBar.appendChild(breadcrumbText);

        this.dirtyIndicator = document.createElement('span');
        this.dirtyIndicator.className = 'dirty-indicator';
        this.dirtyIndicator.style.display = 'none';
        breadcrumbBar.appendChild(this.dirtyIndicator);

        this.container.appendChild(breadcrumbBar);

        // Content area
        const contentEl = document.createElement('div');
        contentEl.className = 'editor-content';

        if (contentType.startsWith('image/')) {
            this._showImage(contentEl, content, path);
        } else if (typeof content === 'string') {
            this._showTextEditor(contentEl, content, path);
        } else {
            this._showBinary(contentEl, content, path);
        }

        this.container.appendChild(contentEl);
        return true;
    }

    _showImage(contentEl, content, path) {
        const img = document.createElement('img');
        if (content instanceof Blob) {
            img.src = URL.createObjectURL(content);
            img.onload = () => URL.revokeObjectURL(img.src);
        }
        img.alt = path.split('/').pop();
        contentEl.appendChild(img);
    }

    _showBinary(contentEl, content, path) {
        const size = content instanceof Blob ? content.size : 0;
        const notice = document.createElement('div');
        notice.className = 'binary-notice';
        notice.innerHTML = `<p>Binary file (${this._humanSize(size)})</p>` +
            `<a href="/api/file?path=${encodeURIComponent(path)}" download>Download file</a>`;
        contentEl.appendChild(notice);
    }

    _showTextEditor(contentEl, content, path) {
        this.savedContent = content;
        const ext = this._getExtension(path);
        const isMarkdown = ext === '.md' || ext === '.markdown';

        // Toolbar row for save button + md toggle
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';

        if (isMarkdown) {
            const mdToggle = document.createElement('button');
            mdToggle.className = 'editor-btn md-toggle';
            mdToggle.textContent = 'Preview';
            mdToggle.addEventListener('click', async () => {
                this.mdPreviewMode = !this.mdPreviewMode;
                mdToggle.textContent = this.mdPreviewMode ? 'Edit' : 'Preview';
                if (this.mdPreviewMode) {
                    this._showMarkdownPreview(editorWrapper, this.cm ? this.cm.getValue() : content);
                } else {
                    await this._initCodeMirror(editorWrapper, this.cm ? this.cm.getValue() : content, path);
                }
            });
            toolbar.appendChild(mdToggle);
        }

        if (!this.readonly) {
            const saveBtn = document.createElement('button');
            saveBtn.className = 'editor-btn save-btn';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', () => this.save());
            toolbar.appendChild(saveBtn);
        }

        contentEl.appendChild(toolbar);

        // Editor wrapper (holds CM or preview)
        const editorWrapper = document.createElement('div');
        editorWrapper.className = 'editor-wrapper';
        contentEl.appendChild(editorWrapper);

        this._initCodeMirror(editorWrapper, content, path);
    }

    async _initCodeMirror(wrapper, content, path) {
        // Wait for the CDN loader to finish before checking CodeMirror
        if (window.cmReady) {
            await window.cmReady;
        }
        this._showCodeMirror(wrapper, content, path);
    }

    _showCodeMirror(wrapper, content, path) {
        wrapper.innerHTML = '';
        const mode = this._detectMode(path);

        if (typeof CodeMirror === 'undefined') {
            // Fallback to textarea if CDN is unreachable
            const textarea = document.createElement('textarea');
            textarea.className = 'editor-fallback';
            textarea.value = content;
            textarea.readOnly = this.readonly;
            textarea.addEventListener('input', () => {
                this.dirty = textarea.value !== this.savedContent;
                this._updateDirtyIndicator();
            });
            wrapper.appendChild(textarea);
            return;
        }

        this.cm = CodeMirror(wrapper, {
            value: content,
            mode: mode,
            theme: 'material-darker',
            lineNumbers: true,
            matchBrackets: true,
            autoCloseBrackets: true,
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            styleActiveLine: true,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: false,
            readOnly: this.readonly,
        });

        // Track dirty state
        this.cm.on('change', () => {
            const isDirty = this.cm.getValue() !== this.savedContent;
            if (isDirty !== this.dirty) {
                this.dirty = isDirty;
                this._updateDirtyIndicator();
            }
        });

        // Ctrl+S / Cmd+S to save
        this.cm.setOption('extraKeys', {
            'Ctrl-S': () => this.save(),
            'Cmd-S': () => this.save(),
        });

        // CodeMirror needs a refresh after being added to the DOM
        setTimeout(() => this.cm.refresh(), 1);
    }

    _showMarkdownPreview(wrapper, content) {
        wrapper.innerHTML = '';
        const preview = document.createElement('div');
        preview.className = 'md-preview';
        preview.innerHTML = this._renderMarkdown(content);
        wrapper.appendChild(preview);
    }

    _renderMarkdown(md) {
        let html = md;
        // Escape HTML
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Code blocks (fenced)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Headers
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Bold and italic
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Unordered lists
        html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Horizontal rules
        html = html.replace(/^---+$/gm, '<hr>');

        // Paragraphs (double newlines)
        html = html.replace(/\n\n+/g, '</p><p>');
        html = `<p>${html}</p>`;

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>\s*(<h[1-6]>)/g, '$1');
        html = html.replace(/(<\/h[1-6]>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<hr>)/g, '$1');
        html = html.replace(/(<hr>)\s*<\/p>/g, '$1');

        return html;
    }

    async save() {
        if (this.readonly || !this.currentPath) return;
        const content = this.cm ? this.cm.getValue() : '';
        try {
            await api.updateFile(this.currentPath, content);
            this.savedContent = content;
            this.dirty = false;
            this._updateDirtyIndicator();
            if (typeof window.showToast === 'function') {
                window.showToast('File saved', 'success');
            }
        } catch (err) {
            if (typeof window.showToast === 'function') {
                window.showToast(`Save failed: ${err.message}`, 'error');
            }
        }
    }

    _updateDirtyIndicator() {
        if (this.dirtyIndicator) {
            this.dirtyIndicator.style.display = this.dirty ? 'inline-block' : 'none';
        }
    }

    _getExtension(path) {
        const name = path.split('/').pop();
        // Handle Dockerfile specifically
        if (name === 'Dockerfile' || name.startsWith('Dockerfile.')) return '.dockerfile';
        const dot = name.lastIndexOf('.');
        return dot === -1 ? '' : name.slice(dot).toLowerCase();
    }

    _detectMode(path) {
        const ext = this._getExtension(path);
        const modes = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': { name: 'javascript', typescript: true },
            '.tsx': { name: 'javascript', typescript: true },
            '.py': 'python',
            '.go': 'go',
            '.html': 'htmlmixed',
            '.htm': 'htmlmixed',
            '.css': 'css',
            '.scss': 'css',
            '.md': 'markdown',
            '.markdown': 'markdown',
            '.yml': 'yaml',
            '.yaml': 'yaml',
            '.sh': 'shell',
            '.bash': 'shell',
            '.zsh': 'shell',
            '.json': { name: 'javascript', json: true },
            '.xml': 'xml',
            '.sql': 'sql',
            '.rb': 'ruby',
            '.php': 'php',
            '.rs': 'rust',
            '.c': 'text/x-csrc',
            '.h': 'text/x-csrc',
            '.java': 'text/x-java',
            '.dockerfile': 'dockerfile',
            '.toml': 'toml',
        };
        return modes[ext] || null;
    }

    clear() {
        if (this.dirty && this.currentPath) {
            if (!confirm(`You have unsaved changes to ${this.currentPath}. Discard?`)) {
                return false;
            }
        }
        this.currentPath = null;
        this.cm = null;
        this.dirty = false;
        this.savedContent = '';
        this.container.innerHTML = '<div class="empty-state"><p>Select a file to view its contents</p></div>';
        return true;
    }

    _humanSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
}
