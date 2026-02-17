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
