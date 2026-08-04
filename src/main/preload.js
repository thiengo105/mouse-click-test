'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('platform', {
  os: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
});
