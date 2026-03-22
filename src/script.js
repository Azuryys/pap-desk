// Page Navigation Functions
function goToPlayer() {
    // Player is now a bottom bar on the starter page, no navigation needed.
    // Start playback of the first track if not already playing.
    if (window.playpauseTrack) {
        window.playpauseTrack();
    }
}

function goToStarter() {
    const starterPage = document.getElementById('starterPage');
    const setupPage = document.getElementById('setupPage');
    
    setupPage.classList.remove('active');
    starterPage.classList.add('active');
}

function goToSetup() {
    const setupPage = document.getElementById('setupPage');
    const starterPage = document.getElementById('starterPage');
    
    setupPage.classList.add('active');
    starterPage.classList.remove('active');
    
    window.initSetup();
}

/**
 * Initialize app on startup - check if setup is needed
 */
async function initApp() {
    try {
        const setupStatus = await window.electronAPI.getSetupStatus();
        
        // Always initialize the player early so getPlayerSongs / reloadSongsInPlayer are available
        window.initPlayer();

        if (!setupStatus.setupCompleted) {
            // First time setup needed
            console.log('✓ First time setup required');
            goToSetup();
        } else {
            // Setup already completed, show starter page
            console.log('✓ Setup already completed, loading starter page');
            // Starter page is already active by default in HTML

            // Check for new songs dropped into the music folder since last launch
            checkForNewSongsOnStartup();
        }
    } catch (error) {
        console.error('✗ Failed to check setup status:', error);
        // If there's an error, default to showing starter page
    }
}

/**
 * Check music folder for unimported songs on startup and show notification
 */
async function checkForNewSongsOnStartup() {
    try {
        const result = await window.electronAPI.countUnimportedSongs();
        if (result.success && result.count > 0) {
            const notif = document.getElementById('importNotification');
            const notifText = document.getElementById('importNotificationText');
            if (notif && notifText) {
                notifText.textContent = `Found ${result.count} new song(s) in your music folder.`;
                notif.style.display = '';
            }
        }
    } catch (err) {
        console.warn('Startup scan check failed:', err);
    }
}

/**
 * Handle import from the startup notification banner
 */
async function handleStartupImport() {
    const btn = document.getElementById('importNotifBtn');
    const notifText = document.getElementById('importNotificationText');
    if (btn) btn.disabled = true;
    if (notifText) notifText.textContent = 'Importing songs...';

    try {
        const result = await window.electronAPI.scanExistingSongs();
        if (result.success) {
            if (notifText) notifText.textContent = `Imported ${result.imported} song(s) successfully!`;
            if (window.reloadSongsInPlayer) await window.reloadSongsInPlayer();
        } else {
            if (notifText) notifText.textContent = 'Import failed: ' + (result.message || 'Unknown error');
        }
    } catch (err) {
        if (notifText) notifText.textContent = 'Import error: ' + err.message;
    }

    // Auto-dismiss after a short delay
    setTimeout(() => dismissImportNotification(), 2500);
}

/**
 * Dismiss the import notification banner
 */
function dismissImportNotification() {
    const notif = document.getElementById('importNotification');
    if (notif) notif.style.display = 'none';
}

window.handleStartupImport = handleStartupImport;
window.dismissImportNotification = dismissImportNotification;

function goToSettings() {
    const settingsPage = document.getElementById('settingsPage');
    const starterPage = document.getElementById('starterPage');

    starterPage.classList.remove('active');
    settingsPage.classList.add('active');

    if (window.initSettings) window.initSettings();
}

function goBackFromSettings() {
    const settingsPage = document.getElementById('settingsPage');
    const starterPage = document.getElementById('starterPage');

    settingsPage.classList.remove('active');
    starterPage.classList.add('active');
}

// Make navigation functions globally accessible
window.goToPlayer = goToPlayer;
window.goToStarter = goToStarter;
window.goToSetup = goToSetup;
window.goToSettings = goToSettings;
window.goBackFromSettings = goBackFromSettings;
window.initApp = initApp;

// Modal tab switching for Create Playlist
function showPlaylistTab(tab) {
    const localTab = document.getElementById('playlistTabLocal');
    const youtubeTab = document.getElementById('playlistTabYoutube');
    const localPanel = document.getElementById('playlistTabPanelLocal');
    const youtubePanel = document.getElementById('playlistTabPanelYoutube');
    if (!localTab || !youtubeTab || !localPanel || !youtubePanel) return;
    if (tab === 'local') {
        localTab.classList.add('active');
        youtubeTab.classList.remove('active');
        localPanel.classList.add('active');
        youtubePanel.classList.remove('active');
    } else {
        localTab.classList.remove('active');
        youtubeTab.classList.add('active');
        localPanel.classList.remove('active');
        youtubePanel.classList.add('active');
    }
}
window.showPlaylistTab = showPlaylistTab;

// YouTube Playlist Tab Logic
async function loadYoutubePlaylist() {
    const urlInput = document.getElementById('youtubePlaylistUrl');
    const preview = document.getElementById('youtubePlaylistPreview');
    if (!urlInput || !preview) return;
    const url = urlInput.value.trim();
    if (!url) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
        return;
    }
    preview.classList.remove('hidden');
    preview.innerHTML = '<div class="yt-status loading">Loading playlist info...</div>';
    try {
        // Call IPC handler to fetch playlist info only (no download yet)
        const result = await window.electronAPI.importYoutubePlaylist({ playlistUrl: url });
        if (result.success && result.playlist) {
            const { title, description, cover, videos } = result.playlist;
            preview.innerHTML = `
                <div class="yt-info"><strong>${title}</strong><span>${description || ''}</span></div>
                ${cover ? `<img class="yt-thumb" src="${cover}" alt="Playlist Cover">` : ''}
                <div style="margin-top:8px;font-size:13px;color:var(--muted);">${videos.length} videos detected</div>
            `;
        } else {
            preview.innerHTML = `<div class="yt-status error">${result.message || 'Could not load playlist info.'}</div>`;
        }
    } catch (err) {
        preview.innerHTML = `<div class="yt-status error">Error: ${err.message}</div>`;
    }
}

async function importYoutubePlaylist() {
    const urlInput = document.getElementById('youtubePlaylistUrl');
    if (!urlInput) return;
    const url = urlInput.value.trim();
    if (!url) return;
    // Optionally, show a loading state or disable button
    try {
        const result = await window.electronAPI.importYoutubePlaylist({ playlistUrl: url });
        if (result.success) {
            alert('Playlist imported successfully!');
            closeCreatePlaylistModal();
            // Optionally, refresh playlists in UI
        } else {
            alert('Import failed: ' + (result.message || 'Unknown error'));
        }
    } catch (err) {
        alert('Import error: ' + err.message);
    }
}
window.loadYoutubePlaylist = loadYoutubePlaylist;
window.importYoutubePlaylist = importYoutubePlaylist;

