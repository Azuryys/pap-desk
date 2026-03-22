// Setup state
let musicFolderPath = null;
let thumbnailsFolderPath = null;
let _pendingImportConfig = null;

/**
 * Initialize the setup page
 */
function initSetup() {
    console.log('Initializing setup page');
    // Reset form on init
    resetSetupForm();
}

/**
 * Reset the setup form
 */
function resetSetupForm() {
    musicFolderPath = null;
    thumbnailsFolderPath = null;
    _pendingImportConfig = null;
    
    const musicDisplay = document.getElementById('musicFolderDisplay');
    const thumbnailsDisplay = document.getElementById('thumbnailsFolderDisplay');
    const completeBtn = document.getElementById('completeSetupBtn');
    const errorDiv = document.getElementById('setupError');
    const importSection = document.getElementById('importConfirmation');
    
    if (musicDisplay) {
        musicDisplay.textContent = 'No folder selected';
        musicDisplay.classList.remove('selected');
    }
    if (thumbnailsDisplay) {
        thumbnailsDisplay.textContent = 'No folder selected';
        thumbnailsDisplay.classList.remove('selected');
    }
    if (completeBtn) {
        completeBtn.disabled = true;
    }
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
    if (importSection) {
        importSection.style.display = 'none';
    }

    // Reset detection badges
    const musicBadge = document.getElementById('musicFolderSongCount');
    if (musicBadge) musicBadge.style.display = 'none';
    const thumbBadge = document.getElementById('thumbnailsFolderFileCount');
    if (thumbBadge) thumbBadge.style.display = 'none';
    const backupStatus = document.getElementById('backupSetupStatus');
    if (backupStatus) backupStatus.style.display = 'none';
}

/**
 * Show error message
 */
function showSetupError(message) {
    const errorDiv = document.getElementById('setupError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

/**
 * Hide error message
 */
function hideSetupError() {
    const errorDiv = document.getElementById('setupError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

/**
 * Update the complete setup button state
 */
function updateCompleteButtonState() {
    const completeBtn = document.getElementById('completeSetupBtn');
    if (completeBtn) {
        completeBtn.disabled = !musicFolderPath || !thumbnailsFolderPath;
    }
}

/**
 * Select music folder
 */
async function selectMusicFolder() {
    try {
        hideSetupError();
        const result = await window.electronAPI.openFolderDialog();
        
        if (result.success && result.folderPath) {
            musicFolderPath = result.folderPath;
            const musicDisplay = document.getElementById('musicFolderDisplay');
            if (musicDisplay) {
                musicDisplay.textContent = musicFolderPath;
                musicDisplay.classList.add('selected');
            }
            updateCompleteButtonState();

            // Immediate detection: count audio files in the selected folder
            try {
                const countResult = await window.electronAPI.countFolderSongs(musicFolderPath);
                const badge = document.getElementById('musicFolderSongCount');
                if (badge && countResult.success && countResult.count > 0) {
                    badge.textContent = `\u266B ${countResult.count} song(s) found in this folder!`;
                    badge.style.display = '';
                } else if (badge) {
                    badge.style.display = 'none';
                }
            } catch (e) {
                console.warn('Could not count folder songs:', e);
            }
        }
    } catch (error) {
        console.error('Failed to select music folder:', error);
        showSetupError('Failed to select music folder. Please try again.');
    }
}

/**
 * Select thumbnails folder
 */
async function selectThumbnailsFolder() {
    try {
        hideSetupError();
        const result = await window.electronAPI.openFolderDialog();
        
        if (result.success && result.folderPath) {
            thumbnailsFolderPath = result.folderPath;
            const thumbnailsDisplay = document.getElementById('thumbnailsFolderDisplay');
            if (thumbnailsDisplay) {
                thumbnailsDisplay.textContent = thumbnailsFolderPath;
                thumbnailsDisplay.classList.add('selected');
            }
            updateCompleteButtonState();

            // Immediate detection: count image files in the selected folder
            try {
                const files = thumbnailsFolderPath; // just pass the path
                const countResult = await window.electronAPI.countFolderSongs(thumbnailsFolderPath);
                // countFolderSongs only counts audio files, so we use a broader check
                // For thumbnails we just show a generic "files found" message
                const badge = document.getElementById('thumbnailsFolderFileCount');
                // We'll reuse the IPC but note it only counts audio. For thumbnails,
                // the user mainly cares about the music count. Hide the badge here
                // unless we want a dedicated image counter. Keep it simple:
                if (badge) badge.style.display = 'none';
            } catch (e) {
                console.warn('Could not check thumbnails folder:', e);
            }
        }
    } catch (error) {
        console.error('Failed to select thumbnails folder:', error);
        showSetupError('Failed to select thumbnails folder. Please try again.');
    }
}

/**
 * Complete setup and save configuration
 */
async function completeSetup() {
    try {
        hideSetupError();
        
        if (!musicFolderPath || !thumbnailsFolderPath) {
            showSetupError('Please select both music and thumbnails folders');
            return;
        }

        console.log('Completing setup with paths:', { musicFolderPath, thumbnailsFolderPath });

        // Save setup configuration to database
        const result = await window.electronAPI.saveSetupConfig({
            musicFolderPath,
            thumbnailsFolderPath
        });

        if (result.success) {
            console.log('✓ Setup completed successfully');

            // Check if there are existing songs in the chosen folders
            const countResult = await window.electronAPI.countUnimportedSongs({
                musicFolderPath,
                thumbnailsFolderPath
            });

            if (countResult.success && countResult.count > 0) {
                // Show import confirmation UI
                _pendingImportConfig = { musicFolderPath, thumbnailsFolderPath };
                const importSection = document.getElementById('importConfirmation');
                const importDesc = document.getElementById('importDescription');
                const completeBtn = document.getElementById('completeSetupBtn');

                if (importDesc) {
                    importDesc.textContent = `Found ${countResult.count} song(s) in your music folder. Would you like to import them into your library?`;
                }
                if (importSection) {
                    importSection.style.display = '';
                }
                // Disable complete button while import choice is shown
                if (completeBtn) {
                    completeBtn.disabled = true;
                }
            } else {
                // No existing songs, go straight to starter
                goToStarter();
            }
        } else {
            showSetupError(result.message || 'Failed to save setup configuration');
        }
    } catch (error) {
        console.error('Failed to complete setup:', error);
        showSetupError('An error occurred while completing setup. Please try again.');
    }
}

/**
 * Import existing songs found in the selected music folder
 */
async function importExistingSongs() {
    try {
        const importBtn = document.getElementById('importSongsBtn');
        const skipBtn = document.getElementById('skipImportBtn');
        const statusEl = document.getElementById('importStatus');

        if (importBtn) importBtn.disabled = true;
        if (skipBtn) skipBtn.disabled = true;
        if (statusEl) {
            statusEl.textContent = 'Importing songs... This may take a moment.';
            statusEl.style.display = '';
        }

        const result = await window.electronAPI.scanExistingSongs(_pendingImportConfig);

        if (result.success) {
            if (statusEl) {
                statusEl.textContent = `Successfully imported ${result.imported} song(s)!`;
            }
            console.log(`✓ Imported ${result.imported} songs during setup`);
        } else {
            if (statusEl) {
                statusEl.textContent = 'Import failed: ' + (result.message || 'Unknown error');
            }
        }

        // Navigate to starter after a short delay so the user sees the result
        setTimeout(() => {
            goToStarter();
            if (window.reloadSongsInPlayer) window.reloadSongsInPlayer();
        }, 1200);
    } catch (error) {
        console.error('Failed to import existing songs:', error);
        const statusEl = document.getElementById('importStatus');
        if (statusEl) {
            statusEl.textContent = 'Import error: ' + error.message;
            statusEl.style.display = '';
        }
        // Still allow navigating away
        setTimeout(() => goToStarter(), 2000);
    }
}

/**
 * Skip importing existing songs
 */
function skipImport() {
    _pendingImportConfig = null;
    goToStarter();
}

/**
 * Import from a backup ZIP during setup.
 * The user must have selected both folders first so the files have somewhere to go.
 * After importing, the setup is completed and the user goes to the starter page.
 */
async function importBackupFromSetup() {
    try {
        hideSetupError();

        if (!musicFolderPath || !thumbnailsFolderPath) {
            showSetupError('Please select both music and thumbnails folders before importing a backup.');
            return;
        }

        // Save config first so the main process knows where to extract files
        const saveResult = await window.electronAPI.saveSetupConfig({
            musicFolderPath,
            thumbnailsFolderPath
        });

        if (!saveResult.success) {
            showSetupError('Failed to save folder configuration: ' + (saveResult.message || 'Unknown error'));
            return;
        }

        // Show a status message
        const statusEl = document.getElementById('backupSetupStatus');
        if (statusEl) {
            statusEl.textContent = 'Importing backup... This may take a moment.';
            statusEl.style.display = '';
        }

        const result = await window.electronAPI.importBackup();

        if (result.success) {
            // Restore playlists if present
            if (result.playlistsJson && result.songs) {
                if (window.restorePlaylistsFromBackup) {
                    window.restorePlaylistsFromBackup(result.playlistsJson, result.songs);
                }
            }

            if (statusEl) {
                statusEl.textContent = `Backup restored! ${result.imported} song(s) imported.`;
            }

            console.log('\u2713 Backup imported during setup:', result.imported, 'songs');

            // Navigate to starter after a short delay
            setTimeout(() => {
                goToStarter();
                if (window.reloadSongsInPlayer) window.reloadSongsInPlayer();
            }, 1200);
        } else {
            if (statusEl) {
                statusEl.textContent = 'Import failed: ' + (result.message || 'Unknown error');
                statusEl.style.display = '';
            }
        }
    } catch (error) {
        console.error('Failed to import backup during setup:', error);
        showSetupError('Import failed: ' + error.message);
    }
}

// Export for module imports
export { initSetup, selectMusicFolder, selectThumbnailsFolder, completeSetup, importExistingSongs, skipImport, importBackupFromSetup };

// Make functions globally accessible for onclick handlers
window.initSetup = initSetup;
window.selectMusicFolder = selectMusicFolder;
window.selectThumbnailsFolder = selectThumbnailsFolder;
window.completeSetup = completeSetup;
window.importExistingSongs = importExistingSongs;
window.skipImport = skipImport;
window.importBackupFromSetup = importBackupFromSetup;
