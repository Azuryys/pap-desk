const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { initDatabase, getUserVolume, setUserVolume, closeDatabase, addSong, getAllSongs, deleteSong, getSongByFilePath, isSetupCompleted, getSetupConfig, saveSetupConfig, cleanupMissingSongs } = require('./database');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const AdmZip = require('adm-zip');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Initialize database
initDatabase();

// Variable to store folder paths - will be set after app is ready
let musicFolderPath;
let thumbnailsFolderPath;

// Function to initialize folder paths based on setup config
function initializeFolderPaths() {
  const setupConfig = getSetupConfig();
  musicFolderPath = setupConfig.music_folder_path;
  thumbnailsFolderPath = setupConfig.thumbnails_folder_path;

  // Create default folders in app data directory if setup not completed
  if (!musicFolderPath) {
    musicFolderPath = path.join(app.getPath('userData'), 'music');
  }
  if (!thumbnailsFolderPath) {
    thumbnailsFolderPath = path.join(app.getPath('userData'), 'thumbnails');
  }

  // Ensure folders exist
  if (!fs.existsSync(musicFolderPath)) {
    fs.mkdirSync(musicFolderPath, { recursive: true });
    console.log('✓ Music folder created:', musicFolderPath);
  }
  if (!fs.existsSync(thumbnailsFolderPath)) {
    fs.mkdirSync(thumbnailsFolderPath, { recursive: true });
    console.log('✓ Thumbnails folder created:', thumbnailsFolderPath);
  }
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // Set CSP headers to allow blob URLs for audio and images
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "media-src 'self' blob: data:; " +
          "img-src 'self' blob: data:;"
        ]
      }
    })
  })

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Initialize folder paths now that app is ready
  initializeFolderPaths();

  // Remove songs from database whose files were deleted from disk
  cleanupMissingSongs();
  
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for database operations
ipcMain.handle('get-user-volume', () => {
  return getUserVolume();
});

ipcMain.handle('set-user-volume', (event, volume) => {
  return setUserVolume(volume);
});

// IPC handlers for song operations
ipcMain.handle('add-song', async (event, { songName, audioBuffer, imageBuffer, audioFileName, imageFileName, author, fileName }) => {
  try {
    console.log('IPC: Adding song -', { songName, audioFileName, imageFileName, author });

    // Write audio file to music folder
    const audioDestFileName = `${Date.now()}_${audioFileName}`;
    const destAudioPath = path.join(musicFolderPath, audioDestFileName);
    
    // Convert Uint8Array to Buffer and write
    fs.writeFileSync(destAudioPath, Buffer.from(audioBuffer));
    console.log('✓ Audio file saved:', destAudioPath);

    // Write image file if provided, using interconnected naming
    let destImagePath = null;
    if (imageBuffer && imageFileName) {
      // Extract file extension
      const fileExt = path.extname(imageFileName);
      // Use song name with _thumbnail suffix for interconnected naming
      const imageDestFileName = `${songName}_thumbnail${fileExt}`;
      destImagePath = path.join(thumbnailsFolderPath, imageDestFileName);
      fs.writeFileSync(destImagePath, Buffer.from(imageBuffer));
      console.log('✓ Image file saved:', destImagePath);
    }

    // Store in database
    const songId = addSong(songName, destAudioPath, destImagePath, author, fileName);
    console.log('✓ Song saved to database');
    
    return { success: true, message: 'Song added successfully', songId: songId };
  } catch (error) {
    console.error('✗ Failed to add song:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-all-songs', () => {
  return getAllSongs();
});

ipcMain.handle('get-audio-file', async (event, filePath) => {
  try {
    // Read the audio file as a buffer
    const audioBuffer = await fs.promises.readFile(filePath);
    // Convert to base64 for transport
    const base64Data = audioBuffer.toString('base64');
    return { success: true, data: base64Data };
  } catch (error) {
    console.error('✗ Failed to read audio file:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-image-file', async (event, filePath) => {
  try {
    // Read the image file as a buffer
    const imageBuffer = await fs.promises.readFile(filePath);
    // Convert to base64 for transport
    const base64Data = imageBuffer.toString('base64');
    return { success: true, data: base64Data };
  } catch (error) {
    console.error('✗ Failed to read image file:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('delete-song', async (event, songId) => {
  try {
    // Get song to delete its files
    const songs = getAllSongs();
    const song = songs.find(s => s.id === songId);
    
    if (song) {
      // Delete audio file
      if (song.file_path && fs.existsSync(song.file_path)) {
        fs.unlinkSync(song.file_path);
      }
      // Delete image file
      if (song.image_path && fs.existsSync(song.image_path)) {
        fs.unlinkSync(song.image_path);
      }
    }
    
    deleteSong(songId);
    return { success: true, message: 'Song deleted successfully' };
  } catch (error) {
    console.error('✗ Failed to delete song:', error);
    return { success: false, message: error.message };
  }
});

// IPC handlers for setup
ipcMain.handle('open-folder-dialog', async (event) => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });

    if (result.canceled) {
      return { success: false, folderPath: null };
    }

    if (result.filePaths.length > 0) {
      return { success: true, folderPath: result.filePaths[0] };
    }

    return { success: false, folderPath: null };
  } catch (error) {
    console.error('✗ Failed to open folder dialog:', error);
    return { success: false, folderPath: null, message: error.message };
  }
});

ipcMain.handle('save-setup-config', async (event, { musicFolderPath: newMusicPath, thumbnailsFolderPath: newThumbnailsPath }) => {
  try {
    console.log('IPC: Saving setup config -', { musicFolderPath: newMusicPath, thumbnailsFolderPath: newThumbnailsPath });

    // Verify folders exist or create them
    if (!fs.existsSync(newMusicPath)) {
      fs.mkdirSync(newMusicPath, { recursive: true });
      console.log('✓ Music folder created:', newMusicPath);
    }
    if (!fs.existsSync(newThumbnailsPath)) {
      fs.mkdirSync(newThumbnailsPath, { recursive: true });
      console.log('✓ Thumbnails folder created:', newThumbnailsPath);
    }

    // Save to database
    const result = saveSetupConfig(newMusicPath, newThumbnailsPath);

    if (result) {
      // Update global variables so new songs use the updated paths
      musicFolderPath = newMusicPath;
      thumbnailsFolderPath = newThumbnailsPath;
      console.log('✓ Global folder paths updated:', { musicFolderPath, thumbnailsFolderPath });
      return { success: true, message: 'Setup configuration saved' };
    } else {
      return { success: false, message: 'Failed to save setup configuration' };
    }
  } catch (error) {
    console.error('✗ Failed to save setup config:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-setup-status', async (event) => {
  try {
    const completed = isSetupCompleted();
    const config = getSetupConfig();
    return { 
      success: true, 
      setupCompleted: completed,
      config
    };
  } catch (error) {
    console.error('✗ Failed to get setup status:', error);
    return { 
      success: false, 
      setupCompleted: false,
      config: { music_folder_path: null, thumbnails_folder_path: null }
    };
  }
});

// IPC handlers for custom CSS theme
ipcMain.handle('save-custom-css', async (event, cssContent) => {
  try {
    const cssPath = path.join(app.getPath('userData'), 'custom-theme.css');
    fs.writeFileSync(cssPath, cssContent, 'utf-8');
    console.log('✓ Custom CSS theme saved:', cssPath);
    return { success: true };
  } catch (error) {
    console.error('✗ Failed to save custom CSS:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('load-custom-css', async (event) => {
  try {
    const cssPath = path.join(app.getPath('userData'), 'custom-theme.css');
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, 'utf-8');
      return { success: true, css };
    }
    return { success: false };
  } catch (error) {
    console.error('✗ Failed to load custom CSS:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('remove-custom-css', async (event) => {
  try {
    const cssPath = path.join(app.getPath('userData'), 'custom-theme.css');
    if (fs.existsSync(cssPath)) {
      fs.unlinkSync(cssPath);
      console.log('✓ Custom CSS theme removed');
    }
    return { success: true };
  } catch (error) {
    console.error('✗ Failed to remove custom CSS:', error);
    return { success: false, message: error.message };
  }
});

// ── YouTube IPC handlers ──────────────────────────────────────────────────────
// Fetch YouTube playlist metadata and download all videos
ipcMain.handle('import-youtube-playlist', async (_event, { playlistUrl, playlistName, playlistCover, playlistDescription }) => {
  try {
    // Validate playlist URL
    if (!/^https?:\/\/(www\.)?youtube\.com\/playlist\?list=/.test(playlistUrl)) {
      return { success: false, message: 'Invalid YouTube playlist URL' };
    }

    // Fetch playlist metadata
    const playlistInfo = await youtubedl(playlistUrl, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      skipDownload: true,
    });

    const title = playlistInfo.title || playlistName || 'Untitled Playlist';
    const description = playlistInfo.description || playlistDescription || '';
    const coverUrl = playlistInfo.thumbnail || null;

    // Download cover image if available
    let coverDataUrl = null;
    if (coverUrl) {
      try {
        const resp = await fetch(coverUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const contentType = resp.headers.get('content-type') || 'image/jpeg';
          coverDataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
        }
      } catch (e) {
        console.warn('Could not fetch playlist cover:', e.message);
      }
    }

    // Iterate over videos in playlist
    const videos = playlistInfo.entries || [];
    const importedVideos = [];
    for (const video of videos) {
      const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
      const videoTitle = video.title || 'Unknown Title';
      const videoAuthor = video.uploader || video.channel || 'Unknown';
      const safeName = videoTitle.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const timestamp = Date.now();
      const mp3FileName = `${timestamp}_${safeName}.mp3`;
      const mp3Path = path.join(musicFolderPath, mp3FileName);

      // Download audio
      await youtubedl(videoUrl, {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: '192K',
        output: mp3Path,
        ffmpegLocation: ffmpegPath,
        noCheckCertificates: true,
        noWarnings: true,
      });
      console.log('✓ Playlist video audio saved as MP3:', mp3Path);

      // Download thumbnail
      let destImagePath = null;
      const thumbUrl = video.thumbnail || (video.thumbnails && video.thumbnails.length > 0 ? video.thumbnails[video.thumbnails.length - 1].url : null);
      if (thumbUrl) {
        try {
          const response = await fetch(thumbUrl);
          if (response.ok) {
            const arrayBuf = await response.arrayBuffer();
            const imageFileName = `${safeName}_thumbnail.jpg`;
            destImagePath = path.join(thumbnailsFolderPath, imageFileName);
            fs.writeFileSync(destImagePath, Buffer.from(arrayBuf));
            console.log('✓ Playlist video thumbnail saved:', destImagePath);
          }
        } catch (thumbErr) {
          console.warn('Could not download playlist video thumbnail:', thumbErr.message);
        }
      }

      // Store in database
      const songId = addSong(videoTitle, mp3Path, destImagePath, videoAuthor, mp3FileName);
      importedVideos.push({ songId, title: videoTitle, author: videoAuthor });
    }

    return {
      success: true,
      playlist: {
        title,
        description,
        cover: coverDataUrl,
        videos: importedVideos,
      },
      message: 'Playlist imported successfully',
    };
  } catch (error) {
    console.error('YouTube playlist import failed:', error);
    return { success: false, message: error.message };
  }
});

function isValidYoutubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url);
}

// ── Spotify IPC handlers ──────────────────────────────────────────────────────

function isValidSpotifyTrackUrl(url) {
  return /^(https?:\/\/)?(open\.)?spotify\.com\/track\/[A-Za-z0-9]+/.test(url);
}

// Fetch Spotify track metadata via the public oEmbed endpoint (no API key needed)
ipcMain.handle('get-spotify-info', async (_event, url) => {
  try {
    if (!isValidSpotifyTrackUrl(url)) {
      return { success: false, message: 'Invalid Spotify track URL' };
    }

    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const resp = await fetch(oembedUrl);
    if (!resp.ok) {
      return { success: false, message: 'Could not fetch Spotify track info' };
    }
    const data = await resp.json();

    // oEmbed returns { title: "Song - Artist", thumbnail_url, ... }
    // Parse title into song name and artist
    let songTitle = data.title || 'Unknown Title';
    let artist = '';
    // Spotify oEmbed title format is typically "Song Name" from the embed HTML
    // but the actual title field is the track name
    // The author_name field contains the artist
    if (data.author_name) {
      artist = data.author_name;
    }

    // Fetch thumbnail and convert to data URL (same as YouTube approach)
    let thumbnailDataUrl = null;
    if (data.thumbnail_url) {
      try {
        const thumbResp = await fetch(data.thumbnail_url);
        if (thumbResp.ok) {
          const buf = Buffer.from(await thumbResp.arrayBuffer());
          const contentType = thumbResp.headers.get('content-type') || 'image/jpeg';
          thumbnailDataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
        }
      } catch (e) {
        console.warn('Could not fetch Spotify thumbnail:', e.message);
      }
    }

    return {
      success: true,
      data: {
        title: songTitle,
        artist: artist,
        thumbnail: thumbnailDataUrl,
        thumbnailUrl: data.thumbnail_url || null,
      }
    };
  } catch (error) {
    console.error('Spotify info fetch failed:', error);
    return { success: false, message: error.message };
  }
});

// Download Spotify track: search YouTube for the song and download via yt-dlp
ipcMain.handle('download-spotify-audio', async (_event, { songName, artist, thumbnailUrl }) => {
  try {
    const finalName = songName || 'Unknown Title';
    const finalArtist = artist || 'Unknown';
    const searchQuery = `ytsearch1:${finalName} ${finalArtist}`;

    const safeName = finalName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    const timestamp = Date.now();

    // ── 1. Download & convert audio via yt-dlp YouTube search ──────────
    const mp3FileName = `${timestamp}_${safeName}.mp3`;
    const mp3Path = path.join(musicFolderPath, mp3FileName);

    await youtubedl(searchQuery, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '192K',
      output: mp3Path,
      ffmpegLocation: ffmpegPath,
      noCheckCertificates: true,
      noWarnings: true,
    });
    console.log('✓ Spotify track audio saved as MP3:', mp3Path);

    // ── 2. Download Spotify album art thumbnail ─────────────────────────
    let destImagePath = null;
    if (thumbnailUrl) {
      try {
        const response = await fetch(thumbnailUrl);
        if (response.ok) {
          const arrayBuf = await response.arrayBuffer();
          const imageFileName = `${safeName}_thumbnail.jpg`;
          destImagePath = path.join(thumbnailsFolderPath, imageFileName);
          fs.writeFileSync(destImagePath, Buffer.from(arrayBuf));
          console.log('✓ Spotify thumbnail saved:', destImagePath);
        }
      } catch (thumbErr) {
        console.warn('Could not download Spotify thumbnail:', thumbErr.message);
      }
    }

    // ── 3. Store in database ────────────────────────────────────────────
    const songId = addSong(finalName, mp3Path, destImagePath, finalArtist, mp3FileName);
    console.log('✓ Spotify song saved to database, id:', songId);

    return { success: true, songId, message: 'Song downloaded successfully' };
  } catch (error) {
    console.error('Spotify download failed:', error);
    return { success: false, message: error.message };
  }
});

// Fetch metadata only (title, author, thumbnail URL, duration)
ipcMain.handle('get-youtube-info', async (_event, url) => {
  try {
    if (!isValidYoutubeUrl(url)) {
      return { success: false, message: 'Invalid YouTube URL' };
    }
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
    });
    // Fetch thumbnail and convert to data URL so it doesn't violate CSP
    let thumbnailDataUrl = null;
    const thumbnailUrl = info.thumbnail || (info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : null);
    if (thumbnailUrl) {
      try {
        const resp = await fetch(thumbnailUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const contentType = resp.headers.get('content-type') || 'image/jpeg';
          thumbnailDataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
        }
      } catch (e) {
        console.warn('Could not fetch YouTube thumbnail:', e.message);
      }
    }

    return {
      success: true,
      data: {
        title: info.title || 'Unknown Title',
        author: info.uploader || info.channel || 'Unknown',
        thumbnail: thumbnailDataUrl,
        videoId: info.id,
        duration: info.duration,
      }
    };
  } catch (error) {
    console.error('YouTube info fetch failed:', error);
    return { success: false, message: error.message };
  }
});

// Download audio → MP3, save thumbnail, add to DB, return songId
ipcMain.handle('download-youtube-audio', async (_event, { url, songName, author }) => {
  try {
    if (!isValidYoutubeUrl(url)) {
      return { success: false, message: 'Invalid YouTube URL' };
    }

    // Get metadata first for fallback values
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      skipDownload: true,
    });

    const finalName = songName || info.title || 'Unknown Title';
    const finalAuthor = author || info.uploader || info.channel || 'Unknown';

    // Sanitise for file-system usage
    const safeName = finalName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    const timestamp = Date.now();

    // ── 1. Download & convert audio to MP3 via yt-dlp + ffmpeg ──────────
    const mp3FileName = `${timestamp}_${safeName}.mp3`;
    const mp3Path = path.join(musicFolderPath, mp3FileName);

    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '192K',
      output: mp3Path,
      ffmpegLocation: ffmpegPath,
      noCheckCertificates: true,
      noWarnings: true,
    });
    console.log('✓ YouTube audio saved as MP3:', mp3Path);

    // ── 2. Download thumbnail ───────────────────────────────────────────
    let destImagePath = null;
    const thumbUrl = info.thumbnail || (info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : null);
    if (thumbUrl) {
      try {
        const response = await fetch(thumbUrl);
        if (response.ok) {
          const arrayBuf = await response.arrayBuffer();
          const imageFileName = `${safeName}_thumbnail.jpg`;
          destImagePath = path.join(thumbnailsFolderPath, imageFileName);
          fs.writeFileSync(destImagePath, Buffer.from(arrayBuf));
          console.log('✓ Thumbnail saved:', destImagePath);
        }
      } catch (thumbErr) {
        console.warn('Could not download thumbnail:', thumbErr.message);
      }
    }

    // ── 3. Store in database ────────────────────────────────────────────
    const songId = addSong(finalName, mp3Path, destImagePath, finalAuthor, mp3FileName);
    console.log('✓ YouTube song saved to database, id:', songId);

    return { success: true, songId, message: 'Song downloaded successfully' };
  } catch (error) {
    console.error('YouTube download failed:', error);
    return { success: false, message: error.message };
  }
});

// ── Folder scanning & import ──────────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.opus', '.webm']);

/**
 * Strip the leading "timestamp_" prefix that the app prepends when saving files.
 * E.g. "1710000000000_My Song.mp3" → "My Song.mp3"
 */
function stripTimestampPrefix(filename) {
  return filename.replace(/^\d+_/, '');
}

/**
 * Try to find a matching thumbnail in the thumbnails folder for a given audio file.
 * Matching rules (checked in order):
 *   1. baseName (without ext) + "_thumbnail.*"
 *   2. songTitle (from ID3 tags) + "_thumbnail.*"
 */
function findMatchingThumbnail(thumbDir, baseName, songTitle) {
  try {
    const files = fs.readdirSync(thumbDir);
    const candidates = [baseName];
    if (songTitle && songTitle !== baseName) candidates.push(songTitle);

    for (const candidate of candidates) {
      const prefix = `${candidate}_thumbnail`;
      const match = files.find(f => {
        const nameWithoutExt = path.parse(f).name;
        return nameWithoutExt === prefix || f.startsWith(prefix + '.');
      });
      if (match) return path.join(thumbDir, match);
    }
  } catch (err) {
    console.warn('Thumbnail search failed:', err.message);
  }
  return null;
}

/**
 * Scan music folder for audio files not yet in the database.
 * Returns { unimported: [...fileInfos], total: N }
 */
function listUnimportedFiles(musicDir) {
  const allFiles = fs.readdirSync(musicDir);
  const audioFiles = allFiles.filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()));
  const unimported = [];

  for (const file of audioFiles) {
    const fullPath = path.join(musicDir, file);
    if (!getSongByFilePath(fullPath)) {
      unimported.push({ fileName: file, filePath: fullPath });
    }
  }

  return { unimported, total: audioFiles.length };
}

/**
 * Import unimported audio files into the database, reading ID3 tags for metadata.
 */
async function scanAndImportSongs(musicDir, thumbDir) {
  // Dynamic import for ESM-only music-metadata
  const mm = await import('music-metadata');

  const { unimported } = listUnimportedFiles(musicDir);
  let imported = 0;

  for (const { fileName, filePath: audioPath } of unimported) {
    try {
      // Read ID3 tags
      let songName = null;
      let author = null;
      try {
        const metadata = await mm.parseFile(audioPath);
        if (metadata.common.title) songName = metadata.common.title;
        if (metadata.common.artist) author = metadata.common.artist;
      } catch (metaErr) {
        console.warn('Could not read metadata for', fileName, metaErr.message);
      }

      // Fallback: derive name from filename (strip timestamp prefix + extension)
      const stripped = stripTimestampPrefix(fileName);
      const baseName = path.parse(stripped).name;
      if (!songName) songName = baseName;
      if (!author) author = null;

      // Find matching thumbnail
      const thumbPath = findMatchingThumbnail(thumbDir, baseName, songName);

      // Insert into database
      addSong(songName, audioPath, thumbPath, author, fileName);
      imported++;
    } catch (err) {
      console.error('Failed to import', fileName, err);
    }
  }

  console.log(`✓ Scan complete: imported ${imported} of ${unimported.length} new song(s)`);
  return { imported, total: unimported.length };
}

// Count files in music folder that are not yet in the database
ipcMain.handle('count-unimported-songs', async (_event, config) => {
  try {
    const musicDir = (config && config.musicFolderPath) || musicFolderPath;
    const thumbDir = (config && config.thumbnailsFolderPath) || thumbnailsFolderPath;
    if (!musicDir || !fs.existsSync(musicDir)) {
      return { success: true, count: 0 };
    }
    const { unimported } = listUnimportedFiles(musicDir);
    return { success: true, count: unimported.length };
  } catch (error) {
    console.error('✗ Failed to count unimported songs:', error);
    return { success: false, count: 0, message: error.message };
  }
});

// Scan and import all unimported songs from the music folder
ipcMain.handle('scan-existing-songs', async (_event, config) => {
  try {
    const musicDir = (config && config.musicFolderPath) || musicFolderPath;
    const thumbDir = (config && config.thumbnailsFolderPath) || thumbnailsFolderPath;
    if (!musicDir || !fs.existsSync(musicDir)) {
      return { success: true, imported: 0, total: 0 };
    }
    const result = await scanAndImportSongs(musicDir, thumbDir);
    return { success: true, ...result };
  } catch (error) {
    console.error('✗ Failed to scan existing songs:', error);
    return { success: false, imported: 0, total: 0, message: error.message };
  }
});

// ── Backup export / import ────────────────────────────────────────────────────

/**
 * Count ALL audio files in a given folder (regardless of DB state).
 * Used by the setup page for immediate detection feedback.
 */
ipcMain.handle('count-folder-songs', async (_event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: true, count: 0 };
    }
    const files = fs.readdirSync(folderPath);
    const count = files.filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase())).length;
    return { success: true, count };
  } catch (error) {
    console.error('✗ Failed to count folder songs:', error);
    return { success: false, count: 0, message: error.message };
  }
});

/**
 * Export a backup ZIP containing music/, thumbnails/, and playlists.json.
 * @param {string} playlistsJson – raw JSON string from localStorage
 */
ipcMain.handle('export-backup', async (_event, playlistsJson) => {
  try {
    // Let the user pick a save location
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const defaultName = `music-player-backup-${dateStr}.zip`;

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      title: 'Export Backup',
      defaultPath: defaultName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });

    if (canceled || !savePath) {
      return { success: false, message: 'Export cancelled' };
    }

    const zip = new AdmZip();

    // Add music files
    if (musicFolderPath && fs.existsSync(musicFolderPath)) {
      const musicFiles = fs.readdirSync(musicFolderPath);
      for (const file of musicFiles) {
        const fullPath = path.join(musicFolderPath, file);
        if (fs.statSync(fullPath).isFile()) {
          zip.addLocalFile(fullPath, 'music');
        }
      }
    }

    // Add thumbnail files
    if (thumbnailsFolderPath && fs.existsSync(thumbnailsFolderPath)) {
      const thumbFiles = fs.readdirSync(thumbnailsFolderPath);
      for (const file of thumbFiles) {
        const fullPath = path.join(thumbnailsFolderPath, file);
        if (fs.statSync(fullPath).isFile()) {
          zip.addLocalFile(fullPath, 'thumbnails');
        }
      }
    }

    // Enrich playlists with file-name references so they survive re-import
    let enrichedPlaylistsJson = null;
    if (playlistsJson) {
      try {
        const playlists = JSON.parse(playlistsJson);
        const allSongs = getAllSongs();
        const idToFileName = {};
        for (const song of allSongs) {
          idToFileName[song.id] = song.file_name || path.basename(song.file_path);
        }

        for (const pl of playlists) {
          if (Array.isArray(pl.songs)) {
            pl.songFileNames = pl.songs.map(id => idToFileName[id]).filter(Boolean);
          }
        }
        enrichedPlaylistsJson = JSON.stringify(playlists, null, 2);
      } catch (e) {
        console.warn('Could not enrich playlists:', e.message);
        enrichedPlaylistsJson = playlistsJson;
      }
    }

    if (enrichedPlaylistsJson) {
      zip.addFile('playlists.json', Buffer.from(enrichedPlaylistsJson, 'utf-8'));
    }

    zip.writeZip(savePath);
    console.log('✓ Backup exported to:', savePath);
    return { success: true, filePath: savePath };
  } catch (error) {
    console.error('✗ Failed to export backup:', error);
    return { success: false, message: error.message };
  }
});

/**
 * Import a backup ZIP – extracts music/ and thumbnails/ into the configured
 * folders, runs the song-import pipeline, and returns playlist data for
 * the renderer to restore.
 */
ipcMain.handle('import-backup', async (_event) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Backup',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      properties: ['openFile']
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, message: 'Import cancelled' };
    }

    const zipPath = filePaths[0];
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    // Ensure target folders exist
    if (!fs.existsSync(musicFolderPath)) fs.mkdirSync(musicFolderPath, { recursive: true });
    if (!fs.existsSync(thumbnailsFolderPath)) fs.mkdirSync(thumbnailsFolderPath, { recursive: true });

    // Extract music/ and thumbnails/ entries
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.replace(/\\/g, '/'); // normalise

      if (entryName.startsWith('music/')) {
        const fileName = path.basename(entryName);
        if (fileName) {
          const destPath = path.join(musicFolderPath, fileName);
          if (!fs.existsSync(destPath)) {
            fs.writeFileSync(destPath, entry.getData());
          }
        }
      } else if (entryName.startsWith('thumbnails/')) {
        const fileName = path.basename(entryName);
        if (fileName) {
          const destPath = path.join(thumbnailsFolderPath, fileName);
          if (!fs.existsSync(destPath)) {
            fs.writeFileSync(destPath, entry.getData());
          }
        }
      }
    }

    // Import newly extracted songs into the database
    const importResult = await scanAndImportSongs(musicFolderPath, thumbnailsFolderPath);

    // Read playlists.json from the ZIP if present
    let playlistsJson = null;
    const plEntry = zip.getEntry('playlists.json');
    if (plEntry) {
      playlistsJson = plEntry.getData().toString('utf-8');
    }

    // Return the new songs list so the renderer can remap playlist IDs
    const allSongs = getAllSongs();

    console.log(`✓ Backup imported: ${importResult.imported} songs`);
    return {
      success: true,
      imported: importResult.imported,
      total: importResult.total,
      playlistsJson,
      songs: allSongs
    };
  } catch (error) {
    console.error('✗ Failed to import backup:', error);
    return { success: false, message: error.message };
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
