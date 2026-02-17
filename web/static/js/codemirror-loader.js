// Container Visualize — CodeMirror 5 CDN loader
// Dynamically loads CodeMirror core, theme, modes, and addons from cdnjs.
// Exposes window.cmReady (a Promise that resolves when everything is loaded,
// or rejects/resolves(false) if the CDN is unreachable).

(function () {
    const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16';

    const CSS = [
        'codemirror.min.css',
        'theme/material-darker.min.css',
        'addon/fold/foldgutter.min.css',
        'addon/dialog/dialog.min.css',
    ];

    const MODES = [
        'javascript', 'xml', 'htmlmixed', 'css', 'markdown',
        'python', 'go', 'yaml', 'shell', 'dockerfile',
        'clike', 'toml', 'sql', 'ruby', 'php', 'rust',
    ];

    const ADDONS = [
        'selection/active-line',
        'edit/matchbrackets',
        'edit/closebrackets',
        'fold/foldcode',
        'fold/foldgutter',
        'fold/brace-fold',
        'fold/comment-fold',
        'search/search',
        'search/searchcursor',
        'dialog/dialog',
        'search/jump-to-line',
    ];

    function loadCSS(path) {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${CDN}/${path}`;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }

    function loadJS(path) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${CDN}/${path}`;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    window.cmReady = (async function () {
        try {
            // 1. Load all CSS in parallel (non-blocking)
            const cssPromises = CSS.map(loadCSS);

            // 2. Load core JS first (modes and addons depend on it)
            await loadJS('codemirror.min.js');

            // 3. Load modes and addons in parallel
            const modePromises = MODES.map(m => loadJS(`mode/${m}/${m}.min.js`));
            const addonPromises = ADDONS.map(a => loadJS(`addon/${a}.min.js`));

            await Promise.all([...cssPromises, ...modePromises, ...addonPromises]);
            return true;
        } catch {
            // CDN unreachable — editor.js will fall back to <textarea>
            console.warn('CodeMirror CDN unavailable, falling back to textarea');
            return false;
        }
    })();
})();
