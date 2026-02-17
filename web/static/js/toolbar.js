// Container Visualize — Toolbar with search and theme toggle

class Toolbar {
    constructor(headerEl) {
        this.header = headerEl;
        this.badge = document.getElementById('container-badge');
        this.refreshBtn = document.getElementById('btn-refresh');
        this.uploadBtn = document.getElementById('btn-upload');
        this.downloadBtn = document.getElementById('btn-download');
        this.themeBtn = document.getElementById('btn-theme');
        this.searchInput = document.getElementById('search-input');
        this.searchResults = document.getElementById('search-results');

        this._searchTimeout = null;
        this._highlightedIndex = -1;
        this._results = [];

        this._initThemeToggle();
        this._initSearch();
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

    onSearchSelect(callback) {
        this._onSearchSelect = callback;
    }

    focusSearch() {
        if (this.searchInput) {
            this.searchInput.focus();
            this.searchInput.select();
        }
    }

    // Theme toggle
    _initThemeToggle() {
        // Restore saved theme preference
        const saved = localStorage.getItem('cv-theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        }
        this._updateThemeIcon();

        if (this.themeBtn) {
            this.themeBtn.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme') || 'dark';
                const next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('cv-theme', next);
                this._updateThemeIcon();

                // Notify editor to update CodeMirror theme
                window.dispatchEvent(new CustomEvent('theme-change', { detail: { theme: next } }));
            });
        }
    }

    _updateThemeIcon() {
        if (!this.themeBtn) return;
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        // Moon for dark, sun for light
        this.themeBtn.textContent = theme === 'dark' ? '\u263E' : '\u2600';
        this.themeBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }

    // Search
    _initSearch() {
        if (!this.searchInput || !this.searchResults) return;

        this.searchInput.addEventListener('input', () => {
            clearTimeout(this._searchTimeout);
            const query = this.searchInput.value.trim();

            if (query.length === 0) {
                this._hideResults();
                return;
            }

            this._searchTimeout = setTimeout(() => {
                this._performSearch(query);
            }, 300);
        });

        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._hideResults();
                this.searchInput.blur();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._moveHighlight(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._moveHighlight(-1);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this._highlightedIndex >= 0 && this._highlightedIndex < this._results.length) {
                    this._selectResult(this._results[this._highlightedIndex]);
                }
                return;
            }
        });

        // Dismiss on click outside
        document.addEventListener('click', (e) => {
            if (!this.searchInput.contains(e.target) && !this.searchResults.contains(e.target)) {
                this._hideResults();
            }
        });
    }

    async _performSearch(query) {
        if (query.length < 2) {
            this._hideResults();
            return;
        }

        // Always search the backend for >= 3 chars
        if (query.length >= 3) {
            this._showSearching();
            try {
                const results = await api.search(query, '/');
                this._results = results || [];
                this._highlightedIndex = -1;
                this._renderResults(query);
            } catch (err) {
                this._results = [];
                this.searchResults.innerHTML = `<div class="search-result-hint">Search error: ${err.message}</div>`;
                this.searchResults.classList.add('visible');
            }
        }
    }

    _showSearching() {
        this.searchResults.innerHTML = '<div class="search-result-hint"><span class="spinner"></span> Searching...</div>';
        this.searchResults.classList.add('visible');
    }

    _renderResults(query) {
        this.searchResults.innerHTML = '';

        if (this._results.length === 0) {
            this.searchResults.innerHTML = '<div class="search-result-hint">No results found</div>';
            this.searchResults.classList.add('visible');
            return;
        }

        const queryLower = query.toLowerCase();

        for (let i = 0; i < this._results.length; i++) {
            const result = this._results[i];
            const item = document.createElement('div');
            item.className = 'search-result-item';
            if (i === this._highlightedIndex) item.classList.add('highlighted');

            const nameEl = document.createElement('div');
            nameEl.className = 'search-result-name';
            nameEl.innerHTML = this._highlightMatch(result.name, queryLower);
            item.appendChild(nameEl);

            const pathEl = document.createElement('div');
            pathEl.className = 'search-result-path';
            pathEl.innerHTML = this._highlightMatch(result.path, queryLower);
            item.appendChild(pathEl);

            item.addEventListener('click', () => this._selectResult(result));
            item.addEventListener('mouseenter', () => {
                this._highlightedIndex = i;
                this._updateHighlight();
            });

            this.searchResults.appendChild(item);
        }

        if (this._results.length >= 100) {
            const hint = document.createElement('div');
            hint.className = 'search-result-hint';
            hint.textContent = 'Showing first 100 results. Refine your search for more specific results.';
            this.searchResults.appendChild(hint);
        }

        this.searchResults.classList.add('visible');
    }

    _highlightMatch(text, query) {
        const idx = text.toLowerCase().indexOf(query);
        if (idx === -1) return this._escapeHtml(text);
        const before = this._escapeHtml(text.slice(0, idx));
        const match = this._escapeHtml(text.slice(idx, idx + query.length));
        const after = this._escapeHtml(text.slice(idx + query.length));
        return `${before}<span class="search-match">${match}</span>${after}`;
    }

    _escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _moveHighlight(direction) {
        if (this._results.length === 0) return;
        this._highlightedIndex += direction;
        if (this._highlightedIndex < 0) this._highlightedIndex = this._results.length - 1;
        if (this._highlightedIndex >= this._results.length) this._highlightedIndex = 0;
        this._updateHighlight();
    }

    _updateHighlight() {
        const items = this.searchResults.querySelectorAll('.search-result-item');
        items.forEach((item, i) => {
            item.classList.toggle('highlighted', i === this._highlightedIndex);
        });
        // Scroll highlighted item into view
        if (this._highlightedIndex >= 0 && items[this._highlightedIndex]) {
            items[this._highlightedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    _selectResult(result) {
        this._hideResults();
        this.searchInput.value = '';
        if (this._onSearchSelect) {
            this._onSearchSelect(result);
        }
    }

    _hideResults() {
        this.searchResults.classList.remove('visible');
        this.searchResults.innerHTML = '';
        this._results = [];
        this._highlightedIndex = -1;
    }
}
