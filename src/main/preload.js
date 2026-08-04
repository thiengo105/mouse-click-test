'use strict';

const { contextBridge } = require('electron');

// Must stay shape-compatible with the Tauri shell's initialization script in
// src-tauri/src/main.rs, since the same renderer runs under both.
contextBridge.exposeInMainWorld('platform', {
  os: process.platform,
  arch: process.arch,
  runtime: `Electron ${process.versions.electron}`,
});
