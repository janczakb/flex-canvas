(function () {
    'use strict';
    var script = document.currentScript;
    if (!script || !script.src) throw new Error('FLEX Canvas requires an external script URL.');
    if (window.FlexCanvas) throw new Error('FLEX Canvas is already loaded.');
    var entry = new URL('./browser/index.js', script.src).href;
    var pending;
    function load() {
        if (!pending) pending = import(entry).catch(function (error) { pending = undefined; throw error; });
        return pending;
    }
    window.FlexCanvas = Object.freeze({
        version: '__CANVAS_VERSION__',
        ready: load,
        open: async function (options) { return (await load()).openCanvas(options); },
        mount: async function (container, options) { return (await load()).mountCanvas(container, options); }
    });
})();
