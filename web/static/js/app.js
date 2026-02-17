// Container Visualize — App init and state management

document.addEventListener('DOMContentLoaded', async () => {
    const treeContainer = document.getElementById('file-tree');
    const editorContainer = document.getElementById('editor-panel');
    const headerEl = document.getElementById('header');
    const statusText = document.getElementById('status-text');

    const tree = new FileTree(treeContainer);
    const editor = new EditorPanel(editorContainer);
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
    } catch (err) {
        setStatus(`Error: ${err.message}`);
    }

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
            editor.clear();
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
