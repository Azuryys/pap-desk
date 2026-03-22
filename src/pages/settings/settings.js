/**
 * Settings page logic
 * - Theme upload (custom CSS override)
 * - Library management (reload, reconfigure)
 */

let settingsInitialized = false;

/**
 * Initialize the settings page UI and event listeners
 */
function initSettings() {
    console.log('Initializing settings page');
    refreshThemeStatus();

    if (settingsInitialized) return;
    settingsInitialized = true;

    // Apply theme button
    const applyBtn = document.getElementById('applyThemeBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyTheme);
    }

    // Remove theme button
    const removeBtn = document.getElementById('removeThemeBtn');
    if (removeBtn) {
        removeBtn.addEventListener('click', removeTheme);
    }

    // Reload library button
    const reloadBtn = document.getElementById('reloadLibraryBtn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            if (window.reloadSongsInPlayer) {
                window.reloadSongsInPlayer();
                alert('Library reloaded successfully!');
            }
        });
    }

    // Reconfigure folders button
    const reconfigureBtn = document.getElementById('reconfigureFoldersBtn');
    if (reconfigureBtn) {
        reconfigureBtn.addEventListener('click', () => {
            if (window.goToSetup) window.goToSetup();
        });
    }

    // Export backup button
    const exportBtn = document.getElementById('exportBackupBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExportBackup);
    }

    // Import backup button
    const importBtn = document.getElementById('importBackupBtn');
    if (importBtn) {
        importBtn.addEventListener('click', handleImportBackup);
    }
}

/**
 * Check if a custom theme is currently loaded and update UI accordingly
 */
async function refreshThemeStatus() {
    const statusEl = document.getElementById('themeStatus');
    const statusText = document.getElementById('themeStatusText');
    const existingStyle = document.getElementById('custom-theme');

    if (existingStyle && existingStyle.textContent.trim().length > 0) {
        if (statusEl) statusEl.classList.add('active-theme');
        if (statusText) statusText.textContent = 'Custom theme is active';
    } else {
        if (statusEl) statusEl.classList.remove('active-theme');
        if (statusText) statusText.textContent = 'No custom theme loaded';
    }
}

/**
 * Read the selected CSS file and apply it as an override
 */
async function applyTheme() {
    const fileInput = document.getElementById('themeFileInput');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Please select a CSS file first.');
        return;
    }

    const file = fileInput.files[0];
    if (!file.name.endsWith('.css')) {
        alert('Please select a valid .css file.');
        return;
    }

    try {
        const cssContent = await file.text();

        // Save to disk via IPC
        const result = await window.electronAPI.saveCustomCSS(cssContent);
        if (!result.success) {
            alert('Failed to save theme: ' + (result.message || 'Unknown error'));
            return;
        }

        // Inject into the page
        let styleEl = document.getElementById('custom-theme');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'custom-theme';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = cssContent;

        // Clear file input
        fileInput.value = '';

        refreshThemeStatus();
        console.log('✓ Custom theme applied');
    } catch (error) {
        console.error('Failed to apply theme:', error);
        alert('Error applying theme: ' + error.message);
    }
}

/**
 * Remove the custom theme and revert to defaults
 */
async function removeTheme() {
    try {
        // Remove from disk
        await window.electronAPI.removeCustomCSS();

        // Remove from DOM
        const styleEl = document.getElementById('custom-theme');
        if (styleEl) {
            styleEl.textContent = '';
            styleEl.remove();
        }

        // Clear file input
        const fileInput = document.getElementById('themeFileInput');
        if (fileInput) fileInput.value = '';

        refreshThemeStatus();
        console.log('✓ Custom theme removed');
    } catch (error) {
        console.error('Failed to remove theme:', error);
        alert('Error removing theme: ' + error.message);
    }
}

/**
 * Show a temporary status message in the backup card
 */
function showBackupStatus(message, isError = false) {
    const statusEl = document.getElementById('backupStatus');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.display = '';
        statusEl.style.color = isError ? '#ff6b6b' : '#51cf66';
    }
}

/**
 * Export backup: ZIP containing music, thumbnails, and playlists
 */
async function handleExportBackup() {
    try {
        showBackupStatus('Preparing backup...');

        // Read playlists from localStorage
        const playlistsJson = localStorage.getItem('music_playlists') || null;

        const result = await window.electronAPI.exportBackup(playlistsJson);

        if (result.success) {
            showBackupStatus('Backup exported successfully!');
            console.log('✓ Backup exported to:', result.filePath);
        } else {
            showBackupStatus(result.message || 'Export failed', true);
        }
    } catch (error) {
        console.error('Failed to export backup:', error);
        showBackupStatus('Export failed: ' + error.message, true);
    }
}

/**
 * Import backup: restore music, thumbnails, and playlists from a ZIP
 */
async function handleImportBackup() {
    try {
        showBackupStatus('Importing backup...');

        const result = await window.electronAPI.importBackup();

        if (result.success) {
            // Restore playlists if present
            if (result.playlistsJson && result.songs) {
                restorePlaylistsFromBackup(result.playlistsJson, result.songs);
            }

            // Reload the player's song list
            if (window.reloadSongsInPlayer) {
                window.reloadSongsInPlayer();
            }

            showBackupStatus(`Backup restored! ${result.imported} song(s) imported.`);
            console.log('✓ Backup imported:', result.imported, 'songs');
        } else {
            showBackupStatus(result.message || 'Import failed', true);
        }
    } catch (error) {
        console.error('Failed to import backup:', error);
        showBackupStatus('Import failed: ' + error.message, true);
    }
}

/**
 * Restore playlists from backup data, remapping song IDs via file names
 * @param {string} playlistsJson - The enriched playlists JSON from the backup
 * @param {Array} newSongs - The current songs in the database after import
 */
function restorePlaylistsFromBackup(playlistsJson, newSongs) {
    try {
        const playlists = JSON.parse(playlistsJson);
        
        // Build a lookup: fileName → new song ID
        const fileNameToId = {};
        for (const song of newSongs) {
            const fileName = song.file_name || (song.file_path ? song.file_path.split(/[\\/]/).pop() : null);
            if (fileName) {
                fileNameToId[fileName] = song.id;
            }
        }

        // Remap song IDs for each playlist
        for (const pl of playlists) {
            if (Array.isArray(pl.songFileNames)) {
                pl.songs = pl.songFileNames
                    .map(fn => fileNameToId[fn])
                    .filter(id => id !== undefined);
                // Clean up the temporary field
                delete pl.songFileNames;
            }
        }

        // Save to localStorage
        localStorage.setItem('music_playlists', JSON.stringify(playlists));
        console.log('✓ Playlists restored from backup');

        // Refresh the starter page if available
        if (window.onPlaylistsRestored) {
            window.onPlaylistsRestored();
        }
    } catch (error) {
        console.error('Failed to restore playlists:', error);
    }
}

// Make restorePlaylistsFromBackup globally accessible (used by setup.js too)
window.restorePlaylistsFromBackup = restorePlaylistsFromBackup;

// Export for module imports
export { initSettings };

// Make globally accessible
window.initSettings = initSettings;
