// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

// Expose database API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    importYoutubePlaylist: (opts) => ipcRenderer.invoke('import-youtube-playlist', opts),
  getUserVolume: () => ipcRenderer.invoke('get-user-volume'),
  setUserVolume: (volume) => ipcRenderer.invoke('set-user-volume', volume),
  addSong: (songData) => ipcRenderer.invoke('add-song', songData),
  getAllSongs: () => ipcRenderer.invoke('get-all-songs'),
  deleteSong: (songId) => ipcRenderer.invoke('delete-song', songId),
  getAudioFile: (filePath) => ipcRenderer.invoke('get-audio-file', filePath),
  getImageFile: (filePath) => ipcRenderer.invoke('get-image-file', filePath),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  saveSetupConfig: (config) => ipcRenderer.invoke('save-setup-config', config),
  getSetupStatus: () => ipcRenderer.invoke('get-setup-status'),
  saveCustomCSS: (cssContent) => ipcRenderer.invoke('save-custom-css', cssContent),
  loadCustomCSS: () => ipcRenderer.invoke('load-custom-css'),
  removeCustomCSS: () => ipcRenderer.invoke('remove-custom-css'),
  getYoutubeInfo: (url) => ipcRenderer.invoke('get-youtube-info', url),
  downloadYoutubeAudio: (opts) => ipcRenderer.invoke('download-youtube-audio', opts),
  getSpotifyInfo: (url) => ipcRenderer.invoke('get-spotify-info', url),
  downloadSpotifyAudio: (opts) => ipcRenderer.invoke('download-spotify-audio', opts),
  countUnimportedSongs: (config) => ipcRenderer.invoke('count-unimported-songs', config),
  scanExistingSongs: (config) => ipcRenderer.invoke('scan-existing-songs', config),
  countFolderSongs: (folderPath) => ipcRenderer.invoke('count-folder-songs', folderPath),
  exportBackup: (playlistsJson) => ipcRenderer.invoke('export-backup', playlistsJson),
  importBackup: () => ipcRenderer.invoke('import-backup'),
});
