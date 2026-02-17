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
    const statusText = document.getElementById('status-text');

    // Determine if we're in readonly mode from the container info
    let readonly = false;

    const tree = new FileTree(treeContainer);
    const toolbar = new Toolbar(headerEl);

    // Status helper
    function setStatus(msg) {
        if (statusText) statusText.textContent = msg;
    }

    // Load container info
    try {
        const info = await api.getContainer();
        toolbar.setContainerInfo(info);
        document.title = `${info.name} — Container Visualize`;
        if (info.readonly) readonly = true;
    } catch (err) {
        setStatus(`Error: ${err.message}`);
    }

    const editor = new EditorPanel(editorContainer, readonly);

    // Load root tree
    setStatus('Loading file tree...');
    try {
        await tree.loadRoot();
        setStatus('Ready');
    } catch (err) {
        setStatus(`Error: ${err.message}`);
    }

    // Wire file selection to editor
    treeContainer.addEventListener('file-select', async (e) => {
        const path = e.detail.path;
        setStatus(`Loading ${path}...`);
        try {
            const { content, contentType, size } = await api.getFile(path);
            editor.openFile(path, content, contentType);
            setStatus(path);
        } catch (err) {
            setStatus(`Error: ${err.message}`);
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
                    }
                    setStatus('Ready');
                } catch (err) {
                    window.showToast(`Delete failed: ${err.message}`, 'error');
                }
            },
            'Delete'
        );
    });

    // Wire refresh button
    toolbar.onRefresh(async () => {
        setStatus('Refreshing...');
        try {
            await tree.refresh();
            setStatus('Ready');
        } catch (err) {
            setStatus(`Error: ${err.message}`);
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
            setStatus('Uploading...');
            for (const file of input.files) {
                try {
                    await api.uploadFile(targetDir, file);
                    window.showToast(`Uploaded ${file.name}`, 'success');
                } catch (err) {
                    window.showToast(`Upload failed: ${err.message}`, 'error');
                }
            }
            await tree.refresh();
            setStatus('Ready');
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

    // Global Ctrl+S / Cmd+S handler (in case focus is outside CodeMirror)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            editor.save();
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
});
