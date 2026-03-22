const Database = require('better-sqlite3');
const path = require('node:path');
const { app } = require('electron');

let db;

/**
 * Initialize the database
 */
function initDatabase() {
  try {
    // Store database in app's user data directory
    const dbPath = path.join(app.getPath('userData'), 'app-settings.db');
    
    db = new Database(dbPath);
    
    // Enable foreign keys
    db.pragma('journal_mode = WAL');
    
    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        volume INTEGER DEFAULT 50,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        author TEXT,
        file_path TEXT NOT NULL,
        image_path TEXT,
        file_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        setup_completed INTEGER DEFAULT 0,
        music_folder_path TEXT,
        thumbnails_folder_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Ensure there's always one user record
    const userExists = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userExists.count === 0) {
      db.prepare('INSERT INTO users (volume) VALUES (?)').run(50);
    }

    // Ensure there's always one settings record
    const settingsExists = db.prepare('SELECT COUNT(*) as count FROM settings').get();
    if (settingsExists.count === 0) {
      db.prepare('INSERT INTO settings (setup_completed, music_folder_path, thumbnails_folder_path) VALUES (?, ?, ?)').run(0, null, null);
    }
    
    console.log('✓ Database initialized successfully');
    return db;
  } catch (error) {
    console.error('✗ Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Get the user's volume setting
 */
function getUserVolume() {
  try {
    const result = db.prepare('SELECT volume FROM users WHERE id = 1').get();
    return result ? result.volume : 50;
  } catch (error) {
    console.error('✗ Failed to get user volume:', error);
    return 50;
  }
}

/**
 * Set the user's volume setting
 */
function setUserVolume(volume) {
  try {
    const numericVolume = Number(volume);
    if (!Number.isFinite(numericVolume)) {
      console.warn('✗ Invalid volume value:', volume);
      return false;
    }

    const clampedVolume = Math.max(0, Math.min(100, Math.round(numericVolume))); // Clamp 0-100
    const current = db.prepare('SELECT volume FROM users WHERE id = 1').get();
    if (current && current.volume === clampedVolume) {
      return true;
    }

    db.prepare('UPDATE users SET volume = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(clampedVolume);
    console.log(`✓ Volume saved: ${clampedVolume}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to set user volume:', error);
    return false;
  }
}

/**
 * Close the database connection
 */
function closeDatabase() {
  try {
    if (db) {
      db.close();
      console.log('✓ Database closed');
    }
  } catch (error) {
    console.error('✗ Failed to close database:', error);
  }
}

/**
 * Add a new song to the database
 */
function addSong(name, filePath, imagePath, author, fileName) {
  try {
    const result = db.prepare(`
      INSERT INTO songs (name, file_path, image_path, author, file_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, filePath, imagePath, author, fileName);
    console.log(`✓ Song added: ${name}`);
    return result.lastInsertRowid;
  }   catch (error) {
    console.error('✗ Failed to add song:', error);
    return false;
  }
}

/**
 * Get all songs from the database
 */
function getAllSongs() {
  try {
    const songs = db.prepare('SELECT * FROM songs ORDER BY created_at DESC').all();
    return songs;
  } catch (error) {
    console.error('✗ Failed to get songs:', error);
    return [];
  }
}

/**
 * Check if a song with the given file path already exists in the database
 */
function getSongByFilePath(filePath) {
  try {
    const result = db.prepare('SELECT id FROM songs WHERE file_path = ?').get(filePath);
    return result || null;
  } catch (error) {
    console.error('✗ Failed to get song by file path:', error);
    return null;
  }
}

/**
 * Delete a song from the database
 */
function deleteSong(songId) {
  try {
    db.prepare('DELETE FROM songs WHERE id = ?').run(songId);
    console.log(`✓ Song deleted: ${songId}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to delete song:', error);
    return false;
  }
}

/**
 * Check if setup has been completed
 */
function isSetupCompleted() {
  try {
    const result = db.prepare('SELECT setup_completed FROM settings WHERE id = 1').get();
    return result ? result.setup_completed === 1 : false;
  } catch (error) {
    console.error('✗ Failed to check setup status:', error);
    return false;
  }
}

/**
 * Get setup configuration
 */
function getSetupConfig() {
  try {
    const result = db.prepare('SELECT music_folder_path, thumbnails_folder_path FROM settings WHERE id = 1').get();
    return result || { music_folder_path: null, thumbnails_folder_path: null };
  } catch (error) {
    console.error('✗ Failed to get setup config:', error);
    return { music_folder_path: null, thumbnails_folder_path: null };
  }
}

/**
 * Save setup configuration
 */
function saveSetupConfig(musicFolderPath, thumbnailsFolderPath) {
  try {
    db.prepare(`
      UPDATE settings 
      SET setup_completed = 1, music_folder_path = ?, thumbnails_folder_path = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = 1
    `).run(musicFolderPath, thumbnailsFolderPath);
    console.log('✓ Setup configuration saved');
    return true;
  } catch (error) {
    console.error('✗ Failed to save setup config:', error);
    return false;
  }
}

/**
 * Remove songs from the database whose audio files no longer exist on disk
 */
function cleanupMissingSongs() {
  try {
    const fs = require('node:fs');
    const songs = getAllSongs();
    let removedCount = 0;

    for (const song of songs) {
      if (!song.file_path || !fs.existsSync(song.file_path)) {
        db.prepare('DELETE FROM songs WHERE id = ?').run(song.id);
        console.log(`✓ Removed missing song from database: ${song.name} (${song.file_path})`);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`✓ Cleaned up ${removedCount} song(s) with missing files`);
    }
    return removedCount;
  } catch (error) {
    console.error('✗ Failed to clean up missing songs:', error);
    return 0;
  }
}

module.exports = {
  initDatabase,
  getUserVolume,
  setUserVolume,
  closeDatabase,
  addSong,
  getAllSongs,
  deleteSong,
  getSongByFilePath,
  isSetupCompleted,
  getSetupConfig,
  saveSetupConfig,
  cleanupMissingSongs,
};
