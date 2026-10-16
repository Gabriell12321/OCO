'use strict';

const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('quarto:visibility', (_event, paused) => {
  window.dispatchEvent(new Event(paused ? 'quarto:pause' : 'quarto:resume'));
});

// The renderer can only submit diagnostics. It cannot read local files, run
// commands, open links, or choose the output path.
contextBridge.exposeInMainWorld('desktopDiagnostics', Object.freeze({
  isDesktop: true,
  report(value) {
    try {
      const json = JSON.stringify(value);
      if (typeof json === 'string' && json.length < 65536) {
        ipcRenderer.send('quarto:diagnostics', json);
      }
    } catch { /* Diagnostics must never interrupt the room. */ }
  },
}));
