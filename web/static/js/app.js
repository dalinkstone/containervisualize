// Container Visualize — App init and state management

// Toast notification system
window.showToast = function(message, type) {
    type = type || 'info';
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
};

// Confirmation dialog
window.showConfirm = function(message, onConfirm, actionLabel) {
    actionLabel = actionLabel || 'Delete';

    // Remove any existing dialog
    const existing = document.getElementById('confirm-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-dialog-overlay';
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';

    const msg = document.createElement('p');
    msg.className = 'confirm-message';
    msg.textContent = message;
    dialog.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'confirm-btn confirm-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'confirm-btn confirm-action';
    confirmBtn.textContent = actionLabel;
    confirmBtn.addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Dismiss on Escape
    const onKey = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        }
    };
    document.addEventListener('keydown', onKey);

    // Dismiss on overlay click (outside dialog)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // Focus the cancel button
    cancelBtn.focus();
};

document.addEventListener('DOMContentLoaded', async () => {
    const treeContainer = document.getElementById('file-tree');
    const editorContainer = document.getElementById('editor-panel');
    const headerEl = document.getElementById('header');

    // Status bar elements
    const statusConnectionDot = document.querySelector('.status-dot');
    const statusConnectionText = document.getElementById('status-connection-text');
    const statusFileInfo = document.getElementById('status-file-info');
    const statusContainerEl = document.getElementById('status-container');

    // Connection overlay and banner
    const connectionOverlay = document.getElementById('connection-overlay');
    const containerStoppedBanner = document.getElementById('container-stopped-banner');
    const btnReconnect = document.getElementById('btn-reconnect');

    // Determine if we're in readonly mode from the container info
    let readonly = false;
    let containerInfo = null;
    let connected = true;

    const tree = new FileTree(treeContainer);
    const toolbar = new Toolbar(headerEl);

    // Status helpers
    function setConnectionStatus(isConnected) {
        connected = isConnected;
        if (statusConnectionDot) {
            statusConnectionDot.className = `status-dot ${isConnected ? 'connected' : 'disconnected'}`;
        }
        if (statusConnectionText) {
            statusConnectionText.textContent = isConnected ? 'Connected' : 'Disconnected';
        }
    }

    function setFileInfo(info) {
        if (!statusFileInfo) return;
        if (!info) {
            statusFileInfo.textContent = '';
            return;
        }
        const parts = [];
        if (info.path) parts.push(info.path);
        if (info.size) parts.push(humanSize(info.size));
        if (info.lines) parts.push(`${info.lines} lines`);
        parts.push('UTF-8');
        statusFileInfo.textContent = parts.join('  \u00B7  ');
    }

    function setContainerStatus(info) {
        if (!statusContainerEl || !info) return;
        const statusColor = info.status === 'running' ? 'var(--success)' : 'var(--danger)';
        statusContainerEl.innerHTML =
            `<span style="color:${statusColor}">\u25CF</span> ${info.name}`;
    }

    function humanSize(bytes) {
        if (!bytes || bytes === 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    // Load container info
    try {
        containerInfo = await api.getContainer();
        toolbar.setContainerInfo(containerInfo);
        setContainerStatus(containerInfo);
        document.title = `${containerInfo.name} \u2014 Container Visualize`;
        if (containerInfo.readonly) readonly = true;
        setConnectionStatus(true);
    } catch (err) {
        setConnectionStatus(false);
        window.showToast(`Error: ${err.message}`, 'error');
    }

    const editor = new EditorPanel(editorContainer, readonly);

    // Load root tree
    try {
        await tree.loadRoot();
    } catch (err) {
        window.showToast(`Error loading tree: ${err.message}`, 'error');
    }

    // Wire file selection to editor
    treeContainer.addEventListener('file-select', async (e) => {
        const path = e.detail.path;
        editor.showLoading(path);
        try {
            const { content, contentType, size } = await api.getFile(path);
            editor.openFile(path, content, contentType, size);
            setFileInfo(editor.getFileInfo());
        } catch (err) {
            window.showToast(`Error loading file: ${err.message}`, 'error');
        }
    });

    // Wire search result selection to tree navigation + file opening
    toolbar.onSearchSelect(async (result) => {
        if (result.type === 'file') {
            await tree.navigateToFile(result.path);
        }
    });

    // Wire delete requests from context menu
    treeContainer.addEventListener('file-delete-request', (e) => {
        const path = e.detail.path;
        if (readonly) {
            window.showToast('Cannot delete in read-only mode', 'error');
            return;
        }
        window.showConfirm(
            `Are you sure you want to delete ${path}? This cannot be undone.`,
            async () => {
                try {
                    await api.deleteFile(path);
                    window.showToast(`Deleted ${path}`, 'success');
                    tree.removeNode(path);
                    // Clear editor if the deleted file was open
                    if (editor.currentPath === path) {
                        editor.clear();
                        setFileInfo(null);
                    }
                } catch (err) {
                    window.showToast(`Delete failed: ${err.message}`, 'error');
                }
            },
            'Delete'
        );
    });

    // Wire refresh button
    toolbar.onRefresh(async () => {
        try {
            await tree.refresh();
            window.showToast('Tree refreshed', 'info');
        } catch (err) {
            window.showToast(`Error: ${err.message}`, 'error');
        }
    });

    // Wire upload button
    toolbar.onUpload(() => {
        if (readonly) {
            window.showToast('Cannot upload in read-only mode', 'error');
            return;
        }
        const targetDir = tree.getSelectedDir();
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', async () => {
            if (input.files.length === 0) return;

            // Show upload overlay on sidebar
            const sidebar = document.getElementById('sidebar');
            const overlay = document.createElement('div');
            overlay.className = 'upload-overlay';
            overlay.innerHTML = '<div class="upload-overlay-content"><span class="spinner"></span> Uploading...</div>';
            sidebar.style.position = 'relative';
            sidebar.appendChild(overlay);

            for (const file of input.files) {
                try {
                    await api.uploadFile(targetDir, file);
                    window.showToast(`Uploaded ${file.name}`, 'success');
                } catch (err) {
                    window.showToast(`Upload failed: ${err.message}`, 'error');
                }
            }

            overlay.remove();
            await tree.refresh();
        });
        input.click();
    });

    // Wire download button
    toolbar.onDownload(() => {
        if (editor.currentPath) {
            api.downloadFile(editor.currentPath);
        } else if (tree.selectedPath) {
            if (tree.selectedType === 'directory') {
                api.downloadArchive(tree.selectedPath);
            } else {
                api.downloadFile(tree.selectedPath);
            }
        } else {
            window.showToast('No file or directory selected', 'info');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const isMod = e.ctrlKey || e.metaKey;

        // Ctrl/Cmd+S: Save current file
        if (isMod && e.key === 's') {
            e.preventDefault();
            editor.save();
            return;
        }

        // Ctrl/Cmd+P: Focus search input
        if (isMod && e.key === 'p') {
            e.preventDefault();
            toolbar.focusSearch();
            return;
        }

        // Ctrl/Cmd+Shift+E: Focus file tree
        if (isMod && e.shiftKey && e.key === 'E') {
            e.preventDefault();
            treeContainer.focus();
            return;
        }

        // Escape: Close search results / context menu / modal
        if (e.key === 'Escape') {
            tree._dismissContextMenu();
            return;
        }

        // Delete/Backspace when tree is focused: delete selected node
        if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === treeContainer) {
            if (tree.selectedPath && !readonly) {
                e.preventDefault();
                treeContainer.dispatchEvent(new CustomEvent('file-delete-request', {
                    bubbles: true,
                    detail: { path: tree.selectedPath },
                }));
            }
            return;
        }

        // F2 when tree is focused: rename selected file (via mv exec)
        if (e.key === 'F2' && document.activeElement === treeContainer) {
            if (tree.selectedPath && !readonly) {
                e.preventDefault();
                const oldPath = tree.selectedPath;
                const oldName = oldPath.split('/').pop();
                const newName = prompt('Rename to:', oldName);
                if (newName && newName !== oldName) {
                    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
                    const newPath = parentDir + (parentDir.endsWith('/') ? '' : '/') + newName;
                    // Create new file with content, delete old — or use API
                    // For now, show toast that rename is experimental
                    window.showToast('Rename is not yet supported', 'info');
                }
            }
            return;
        }
    });

    // Sidebar resize handle
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('resize-handle');
    if (handle && sidebar) {
        let dragging = false;

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            dragging = true;
            handle.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const width = Math.min(Math.max(e.clientX, 180), 600);
            sidebar.style.width = `${width}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    // Connection health monitoring — poll every 5 seconds
    let connectionLost = false;
    let retryInterval = null;

    async function checkConnection() {
        try {
            const info = await api.getContainer();
            // Connection restored
            if (connectionLost) {
                connectionLost = false;
                connectionOverlay.style.display = 'none';
                setConnectionStatus(true);
                window.showToast('Connection restored', 'success');
                if (retryInterval) {
                    clearInterval(retryInterval);
                    retryInterval = null;
                }
            }

            // Check container status
            if (info.status !== 'running') {
                containerStoppedBanner.style.display = '';
                setContainerStatus(info);
            } else {
                containerStoppedBanner.style.display = 'none';
                setContainerStatus(info);
            }
            containerInfo = info;
        } catch {
            if (!connectionLost) {
                connectionLost = true;
                setConnectionStatus(false);
                connectionOverlay.style.display = '';
            }
        }
    }

    // Start health check loop
    setInterval(checkConnection, 5000);

    // Reconnect button
    if (btnReconnect) {
        btnReconnect.addEventListener('click', async () => {
            containerStoppedBanner.style.display = 'none';
            await checkConnection();
            if (containerInfo && containerInfo.status === 'running') {
                await tree.refresh();
            }
        });
    }
});
