'use strict';
/* companion/preload.js — the only bridge between the renderer and Node.
 * A single invoke() entry point with an explicit channel allow-list: the
 * renderer can never reach fs, child_process, or arbitrary IPC. */

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = [
  'state', 'ingestUrl', 'ingestText', 'ingestFile', 'sourceText', 'removeSource',
  'search', 'pack', 'saveDistill', 'saveCard', 'removeCard',
  'addJournal', 'removeJournal', 'saveSkills', 'saveSettings',
  'publishLessons', 'exportData', 'importData', 'wipe',
  'capture', 'pickWindow', 'listWindows',
  'bubble', 'window', 'close', 'quit', 'shellInfo'
];

contextBridge.exposeInMainWorld('companion', {
  shell: 'electron',

  invoke(channel, payload) {
    const name = String(channel || '');
    if (ALLOWED.indexOf(name) < 0) {
      return Promise.resolve({ ok: false, error: 'Blocked IPC channel: ' + name });
    }
    return ipcRenderer.invoke('tc:invoke', name, payload === undefined ? null : payload);
  },

  /** Frames pushed by the main process (used for on-demand captures). */
  onFrame(cb) {
    const listener = (_e, payload) => { try { cb(payload); } catch {} };
    ipcRenderer.on('tc:frame', listener);
    return () => ipcRenderer.removeListener('tc:frame', listener);
  },

  /** Commands from the tray, global shortcuts, or window show/hide events. */
  onCommand(cb) {
    const listener = (_e, cmd) => { try { cb(cmd); } catch {} };
    ipcRenderer.on('tc:command', listener);
    return () => ipcRenderer.removeListener('tc:command', listener);
  }
});
