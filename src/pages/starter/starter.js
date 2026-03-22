import defaultThumbnail from '../../images/default thumbnail.png';

const PLAYLIST_STORAGE_KEY = 'music_playlists';
const DEFAULT_PLAYLISTS = [
    {
        id: 'all-songs',
        name: 'All Songs',
        description: 'Every track in your library.',
        cover: null,
        songs: [],
        system: true
    }
];

const durationCache = new Map();
const durationPromises = new Map();
let activePlaylistId = null;
let currentSearchQuery = '';

function setActivePlaylist({ title, subtitle }) {
    const titleEl = document.getElementById('activePlaylistTitle');
    const subtitleEl = document.getElementById('activePlaylistSubtitle');

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
}

function toggleSettingsDropdown() {
    const btn = document.getElementById('sidebarSettingsBtn');
    const dropdown = document.getElementById('sidebarSettingsDropdown');
    if (!dropdown || !btn) return;

    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
        dropdown.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
    } else {
        dropdown.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
    }
}

function handleSettingsAction(action) {
    const dropdown = document.getElementById('sidebarSettingsDropdown');
    const btn = document.getElementById('sidebarSettingsBtn');
    if (dropdown) dropdown.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');

    switch (action) {
        case 'add-song':
            openAddSongModal();
            break;
        case 'settings':
            if (window.goToSettings) window.goToSettings();
            break;
    }
}

function loadPlaylists() {
    try {
        const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY);
        if (!raw) {
            savePlaylists(DEFAULT_PLAYLISTS);
            return [...DEFAULT_PLAYLISTS];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            savePlaylists(DEFAULT_PLAYLISTS);
            return [...DEFAULT_PLAYLISTS];
        }
        return parsed.map((playlist) => ({
            songs: [],
            cover: null,
            description: '',
            system: false,
            ...playlist
        }));
    } catch (error) {
        console.error('Failed to load playlists:', error);
        savePlaylists(DEFAULT_PLAYLISTS);
        return [...DEFAULT_PLAYLISTS];
    }
}

function savePlaylists(playlists) {
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
}

function renderPlaylists(playlists) {
    const container = document.getElementById('sidebarPlaylists');
    if (!container) return;
    container.innerHTML = '';

    playlists.forEach((playlist) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'playlist-item';
        button.dataset.playlistId = playlist.id;
        if (playlist.id === activePlaylistId) {
            button.classList.add('is-active');
        }

        const dot = document.createElement('span');
        dot.className = 'playlist-dot';
        if (playlist.cover) {
            dot.style.backgroundImage = `url("${playlist.cover}")`;
            dot.style.backgroundSize = 'cover';
            dot.style.backgroundPosition = 'center';
        }

        const text = document.createElement('div');
        text.className = 'playlist-text';
        const title = document.createElement('strong');
        title.textContent = playlist.name;
        const subtitle = document.createElement('span');
        subtitle.textContent = playlist.description || 'No description';
        text.appendChild(title);
        text.appendChild(subtitle);

        button.appendChild(dot);
        button.appendChild(text);

        // Triple-dot menu for non-system playlists
        if (!playlist.system) {
            const menuContainer = document.createElement('div');
            menuContainer.className = 'playlist-menu-container';

            const menuBtn = document.createElement('button');
            menuBtn.type = 'button';
            menuBtn.className = 'playlist-menu-btn';
            menuBtn.setAttribute('aria-label', `Menu for ${playlist.name}`);
            menuBtn.textContent = '⋮';

            const menuDropdown = document.createElement('div');
            menuDropdown.className = 'playlist-menu-dropdown';
            menuDropdown.innerHTML = `
                <button class="menu-item danger" data-action="delete">🗑 Delete</button>
            `;

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.playlist-menu-dropdown.active').forEach(d => {
                    if (d !== menuDropdown) d.classList.remove('active');
                });
                menuDropdown.classList.toggle('active');
            });

            menuDropdown.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
                e.stopPropagation();
                menuDropdown.classList.remove('active');
                handleDeletePlaylist(playlist);
            });

            menuContainer.appendChild(menuBtn);
            menuContainer.appendChild(menuDropdown);
            button.appendChild(menuContainer);
        }

        button.addEventListener('click', (e) => {
            // Don't switch playlist if clicking the menu
            if (e.target.closest('.playlist-menu-container')) return;
            setActivePlaylistById(playlist.id);
        });

        container.appendChild(button);
    });
}

function handleDeletePlaylist(playlist) {
    if (playlist.system) return;
    if (!confirm(`Delete playlist "${playlist.name}"?`)) return;

    const playlists = loadPlaylists();
    const updated = playlists.filter(p => p.id !== playlist.id);
    savePlaylists(updated);

    // If the deleted playlist was active, switch to the first one
    if (activePlaylistId === playlist.id) {
        setActivePlaylistById(updated[0]?.id);
    } else {
        renderPlaylists(updated);
    }
}

function getPlayerSongs() {
    if (window.getPlayerSongs) {
        return window.getPlayerSongs() || [];
    }
    return [];
}

function getPlaylistById(playlists, id) {
    return playlists.find((playlist) => playlist.id === id);
}

function setActivePlaylistById(id) {
    const playlists = loadPlaylists();
    const playlist = getPlaylistById(playlists, id) || playlists[0];
    if (!playlist) return;
    activePlaylistId = playlist.id;

    setActivePlaylist({
        title: playlist.name,
        subtitle: playlist.description || 'No description'
    });

    renderPlaylists(playlists);
    renderPlaylistSongs(playlist);
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getSongKey(song) {
    return String(song?.id ?? song?.filePath ?? song?.music ?? song?.name ?? Math.random());
}

function getSongDuration(song) {
    const key = getSongKey(song);
    if (durationCache.has(key)) {
        return Promise.resolve(durationCache.get(key));
    }
    if (durationPromises.has(key)) {
        return durationPromises.get(key);
    }

    const promise = new Promise(async (resolve) => {
        try {
            let src = song.music;
            let isBlob = false;

            if (song.isCustom && song.filePath && window.electronAPI?.getAudioFile) {
                const result = await window.electronAPI.getAudioFile(song.filePath);
                if (result.success) {
                    const binaryString = atob(result.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: 'audio/mpeg' });
                    src = URL.createObjectURL(blob);
                    isBlob = true;
                }
            }

            if (!src) {
                durationCache.set(key, null);
                resolve(null);
                return;
            }

            const audio = new Audio();
            const timeoutId = setTimeout(() => {
                durationCache.set(key, null);
                resolve(null);
            }, 8000);

            audio.preload = 'metadata';
            audio.src = src;

            audio.addEventListener('loadedmetadata', () => {
                clearTimeout(timeoutId);
                durationCache.set(key, audio.duration);
                resolve(audio.duration);
                if (isBlob) URL.revokeObjectURL(src);
            });

            audio.addEventListener('error', () => {
                clearTimeout(timeoutId);
                durationCache.set(key, null);
                resolve(null);
                if (isBlob) URL.revokeObjectURL(src);
            });
        } catch (error) {
            console.error('Failed to read song duration:', error);
            durationCache.set(key, null);
            resolve(null);
        }
    });

    durationPromises.set(key, promise);
    promise.finally(() => durationPromises.delete(key));
    return promise;
}

function renderPlaylistSongs(playlist) {
    const listEl = document.getElementById('playlistSongList');
    const countEl = document.getElementById('playlistSongCount');
    if (!listEl || !countEl) return;

    const allSongs = getPlayerSongs();
    let songs = playlist.id === 'all-songs'
        ? allSongs
        : (playlist.songs || []).map((songId) => allSongs.find((song) => song.id === songId)).filter(Boolean);

    // Apply search filter
    if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase();
        songs = songs.filter(song =>
            (song.name && song.name.toLowerCase().includes(q)) ||
            (song.artist && song.artist.toLowerCase().includes(q))
        );
    }

    const queueIds = songs.map((song) => song.id).filter(Boolean);

    countEl.textContent = `${songs.length} songs`;
    listEl.innerHTML = '';

    if (!songs.length) {
        const empty = document.createElement('li');
        empty.className = 'playlist-empty';
        empty.textContent = 'No songs in this playlist yet.';
        listEl.appendChild(empty);
        return;
    }

    songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.className = 'playlist-song-item';

        // Thumbnail with play overlay
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'song-thumbnail-container';
        
        const thumbnail = document.createElement('div');
        thumbnail.className = 'song-thumbnail';
        thumbnail.style.backgroundImage = `url('${defaultThumbnail}')`;
        
        // Load image if custom song
        if (song.isCustom && song.imagePath) {
            window.electronAPI.getImageFile(song.imagePath).then(result => {
                if (result.success) {
                    const binaryString = atob(result.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: 'image/jpeg' });
                    const blobUrl = URL.createObjectURL(blob);
                    thumbnail.style.backgroundImage = `url("${blobUrl}")`;
                }
            }).catch(err => console.log('Image load error:', err));
        }

        const playOverlay = document.createElement('div');
        playOverlay.className = 'play-overlay';
        playOverlay.innerHTML = '▶';
        playOverlay.addEventListener('click', (event) => {
            event.stopPropagation();
            if (window.playSongById && song.id) {
                window.playSongById(song.id, queueIds);
            }
        });

        thumbnailContainer.appendChild(thumbnail);
        thumbnailContainer.appendChild(playOverlay);

        // Song info
        const infoContainer = document.createElement('div');
        infoContainer.className = 'song-info';

        const nameSpan = document.createElement('div');
        nameSpan.className = 'song-name';
        nameSpan.textContent = song.name;

        const artistSpan = document.createElement('div');
        artistSpan.className = 'song-artist';
        artistSpan.textContent = song.artist || 'Unknown Artist';

        infoContainer.appendChild(nameSpan);
        infoContainer.appendChild(artistSpan);

        // Duration
        const durationSpan = document.createElement('div');
        durationSpan.className = 'song-duration';
        const songKey = getSongKey(song);
        durationSpan.dataset.songKey = songKey;
        durationSpan.textContent = '...';

        getSongDuration(song).then((duration) => {
            if (durationSpan.dataset.songKey === songKey) {
                durationSpan.textContent = formatDuration(duration);
            }
        });

        // Menu button with dropdown
        const menuContainer = document.createElement('div');
        menuContainer.className = 'song-menu-container';

        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'song-menu-btn';
        menuButton.setAttribute('aria-label', `Menu for ${song.name}`);
        menuButton.textContent = '⋮';

        const dropdown = document.createElement('div');
        dropdown.className = 'song-menu-dropdown';
        dropdown.innerHTML = `
            <button class="menu-item" data-action="play">▶ Play</button>
            <button class="menu-item" data-action="add-to-playlist">+ Add to Playlist</button>
            <button class="menu-item" data-action="share">📤 Share</button>
            <button class="menu-item" data-action="edit">✎ Edit Info</button>
            <button class="menu-item danger" data-action="delete">🗑 Delete</button>
        `;

        menuButton.addEventListener('click', (event) => {
            event.stopPropagation();
            // Close other dropdowns
            document.querySelectorAll('.song-menu-dropdown.active').forEach(d => {
                if (d !== dropdown) d.classList.remove('active');
            });
            dropdown.classList.toggle('active');
        });

        dropdown.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (event) => {
                event.stopPropagation();
                const action = item.dataset.action;
                handleSongMenuAction(action, song, queueIds);
                dropdown.classList.remove('active');
            });
        });

        menuContainer.appendChild(menuButton);
        menuContainer.appendChild(dropdown);

        li.appendChild(thumbnailContainer);
        li.appendChild(infoContainer);
        li.appendChild(durationSpan);
        li.appendChild(menuContainer);
        listEl.appendChild(li);
    });
}

function handleSongMenuAction(action, song, queueIds) {
    switch (action) {
        case 'play':
            if (window.playSongById && song.id) {
                window.playSongById(song.id, queueIds);
            }
            break;
        case 'add-to-playlist':
            console.log('Add to playlist:', song.name);
            alert('Add to playlist - Coming soon!');
            break;
        case 'share':
            console.log('Share:', song.name);
            alert('Share - Coming soon!');
            break;
        case 'edit':
            console.log('Edit:', song.name);
            alert('Edit info - Coming soon!');
            break;
        case 'delete':
            if (confirm(`Delete "${song.name}"?`)) {
                console.log('Delete:', song.name);
                if (window.electronAPI && window.electronAPI.deleteSong) {
                    window.electronAPI.deleteSong(song.id).then(() => {
                        if (window.reloadSongsInPlayer) {
                            window.reloadSongsInPlayer();
                        }
                    });
                }
            }
            break;
    }
}

function openCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('createPlaylistForm');
    if (form) {
        form.reset();
    }
}

async function handleCreatePlaylist(event) {
    event.preventDefault();
    const nameInput = document.getElementById('playlistName');
    const coverInput = document.getElementById('playlistCover');
    const descriptionInput = document.getElementById('playlistDescription');
    const ytPlaylistInput = document.getElementById('youtubePlaylistUrl');

    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
        alert('Please enter a playlist name');
        return;
    }

    let cover = null;
    if (coverInput?.files?.[0]) {
        cover = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(coverInput.files[0]);
        });
    }

    const playlist = {
        id: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        name,
        description: descriptionInput?.value?.trim() || '',
        cover,
        songs: [],
        system: false
    };

    // Download YouTube playlist if URL is provided
    const ytPlaylistUrl = ytPlaylistInput?.value?.trim();
    if (ytPlaylistUrl) {
        try {
            // IPC call to main process to download all videos in playlist
            const result = await window.electronAPI.downloadYoutubePlaylist({
                playlistUrl: ytPlaylistUrl,
                playlistId: playlist.id,
                playlistName: playlist.name
            });
            if (result.success && Array.isArray(result.songIds)) {
                playlist.songs = result.songIds;
            } else {
                alert('Failed to download YouTube playlist: ' + (result.message || 'Unknown error'));
            }
        } catch (err) {
            alert('Error downloading YouTube playlist: ' + err.message);
        }
    }

    const playlists = loadPlaylists();
    playlists.push(playlist);
    savePlaylists(playlists);
    closeCreatePlaylistModal();
    setActivePlaylistById(playlist.id);
}

function initStarterSidebar() {
    const settingsBtn = document.getElementById('sidebarSettingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSettingsDropdown();
        });
    }

    // Handle dropdown item clicks
    const dropdown = document.getElementById('sidebarSettingsDropdown');
    if (dropdown) {
        dropdown.addEventListener('click', (e) => {
            const item = e.target.closest('.settings-dropdown-item');
            if (item) {
                handleSettingsAction(item.dataset.action);
            }
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const wrapper = document.querySelector('.sidebar-settings-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            const dd = document.getElementById('sidebarSettingsDropdown');
            const btn = document.getElementById('sidebarSettingsBtn');
            if (dd && !dd.classList.contains('hidden')) {
                dd.classList.add('hidden');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            }
        }

        // Close playlist menu dropdowns when clicking outside
        if (!e.target.closest('.playlist-menu-container')) {
            document.querySelectorAll('.playlist-menu-dropdown.active').forEach(d => {
                d.classList.remove('active');
            });
        }
    });

    const createButton = document.querySelector('.create-playlist-btn');
    if (createButton) {
        createButton.addEventListener('click', openCreatePlaylistModal);
    }

    // Search input
    const searchInput = document.getElementById('playlistSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value.trim();
            const playlists = loadPlaylists();
            const active = getPlaylistById(playlists, activePlaylistId) || playlists[0];
            if (active) renderPlaylistSongs(active);
        });
    }

    const playlists = loadPlaylists();
    activePlaylistId = playlists[0]?.id || null;
    renderPlaylists(playlists);
    if (activePlaylistId) {
        setActivePlaylistById(activePlaylistId);
    }

    window.onPlayerSongsUpdated = () => {
        const updatedPlaylists = loadPlaylists();
        const active = getPlaylistById(updatedPlaylists, activePlaylistId) || updatedPlaylists[0];
        if (active) {
            renderPlaylistSongs(active);
        }
    };

    // Called by settings/setup after restoring playlists from a backup
    window.onPlaylistsRestored = () => {
        const restoredPlaylists = loadPlaylists();
        activePlaylistId = restoredPlaylists[0]?.id || null;
        renderPlaylists(restoredPlaylists);
        if (activePlaylistId) {
            setActivePlaylistById(activePlaylistId);
        }
    };
}

// Modal Functions
function openAddSongModal() {
    const modal = document.getElementById('addSongModal');
    if (modal) {
        modal.style.display = 'block';
    } else {
        console.error('Modal not found');
    }
}

function closeAddSongModal() {
    const modal = document.getElementById('addSongModal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Reset file form
    const form = document.getElementById('addSongForm');
    if (form) {
        form.reset();
    }
    // Reset YouTube tab state
    _ytCachedInfo = null;
    const ytPreview = document.getElementById('youtubePreview');
    const ytEdit = document.getElementById('youtubeEditFields');
    const ytStatus = document.getElementById('youtubeStatus');
    const ytUrl = document.getElementById('youtubeUrlInput');
    const dlBtn = document.getElementById('youtubeDownloadBtn');
    if (ytPreview) ytPreview.classList.add('hidden');
    if (ytEdit) ytEdit.classList.add('hidden');
    if (ytStatus) ytStatus.classList.add('hidden');
    if (ytUrl) ytUrl.value = '';
    if (dlBtn) { dlBtn.textContent = 'Download MP3'; dlBtn.disabled = true; }
    // Reset Spotify tab state
    _spCachedInfo = null;
    const spPreview = document.getElementById('spotifyPreview');
    const spEdit = document.getElementById('spotifyEditFields');
    const spStatus = document.getElementById('spotifyStatus');
    const spUrl = document.getElementById('spotifyUrlInput');
    const spDlBtn = document.getElementById('spotifyDownloadBtn');
    if (spPreview) spPreview.classList.add('hidden');
    if (spEdit) spEdit.classList.add('hidden');
    if (spStatus) spStatus.classList.add('hidden');
    if (spUrl) spUrl.value = '';
    if (spDlBtn) { spDlBtn.textContent = 'Download MP3'; spDlBtn.disabled = true; }
    // Switch back to file tab
    switchAddSongTab('file');
}

// Close modal when clicking outside
window.onclick = function(event) {
    const addModal = document.getElementById('addSongModal');
    const createModal = document.getElementById('createPlaylistModal');
    if (addModal && event.target === addModal) {
        closeAddSongModal();
    }
    if (createModal && event.target === createModal) {
        closeCreatePlaylistModal();
    }
}

// Handle form submission
async function handleAddSong(event) {
    event.preventDefault();
    
    const audioFileInput = document.getElementById('audioFile');
    const imageFileInput = document.getElementById('imageFile');
    const songNameInput = document.getElementById('songName');
    const authorNameInput = document.getElementById('authorName');

    if (!audioFileInput || !songNameInput || !authorNameInput) {
        alert('Form elements not found');
        return;
    }

    const audioFile = audioFileInput.files[0];
    const imageFile = imageFileInput.files[0];
    let songName = songNameInput.value.trim();
    const author = authorNameInput.value.trim() || null;

    // Validate audio file
    if (!audioFile) {
        alert('Please select an audio file');
        return;
    }

    // Use file name as default if song name is empty
    if (!songName) {
        songName = audioFile.name.split('.').slice(0, -1).join('.');
    }

    try {
        // Check if electronAPI is available
        if (!window.electronAPI || !window.electronAPI.addSong) {
            alert('Error: electronAPI not available');
            console.error('electronAPI not available');
            return;
        }

        // Read files as data URLs
        const audioBuffer = await audioFile.arrayBuffer();
        let imageBuffer = null;
        if (imageFile) {
            imageBuffer = await imageFile.arrayBuffer();
        }

        console.log('Adding song:', { songName, audioFileName: audioFile.name, imageFileName: imageFile?.name, author });

        // Call IPC handler to add song with file buffers
        const result = await window.electronAPI.addSong({
            songName,
            audioBuffer: new Uint8Array(audioBuffer),
            imageBuffer: imageBuffer ? new Uint8Array(imageBuffer) : null,
            audioFileName: audioFile.name,
            imageFileName: imageFile ? imageFile.name : null,
            author,
            fileName: audioFile.name
        });

        console.log('Add song result:', result);

        if (result.success) {
            // Add song to the currently active playlist (if not 'all-songs')
            if (activePlaylistId && activePlaylistId !== 'all-songs' && result.songId) {
                const playlists = loadPlaylists();
                const playlist = getPlaylistById(playlists, activePlaylistId);
                if (playlist) {
                    if (!playlist.songs) playlist.songs = [];
                    playlist.songs.push(result.songId);
                    savePlaylists(playlists);
                }
            }
            alert('Song added successfully!');
            closeAddSongModal();
            // Notify player to reload songs
            if (window.reloadSongsInPlayer) {
                await window.reloadSongsInPlayer();
            }
        } else {
            alert(`Failed to add song: ${result.message}`);
        }
    } catch (error) {
        console.error('Error adding song:', error);
        alert(`Error adding song: ${error.message}`);
    }
}

// ── YouTube helpers ──────────────────────────────────────────────────────────
let _ytCachedInfo = null; // stores last fetched metadata
let _spCachedInfo = null; // stores last fetched Spotify metadata

function switchAddSongTab(tabName) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.modal-tab[data-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
    const panelMap = { file: 'tabFile', youtube: 'tabYoutube', spotify: 'tabSpotify' };
    const panel = document.getElementById(panelMap[tabName]);
    if (panel) panel.classList.add('active');
}

function setYoutubeStatus(message, type) {
    const el = document.getElementById('youtubeStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `yt-status ${type}`; // loading | success | error
}

async function handleYoutubeLoad() {
    const input = document.getElementById('youtubeUrlInput');
    const url = input?.value.trim();
    if (!url) return;

    const loadBtn = document.getElementById('youtubeLoadBtn');
    loadBtn.textContent = 'Loading…';
    loadBtn.disabled = true;
    setYoutubeStatus('Fetching video info…', 'loading');
    _ytCachedInfo = null;

    try {
        const result = await window.electronAPI.getYoutubeInfo(url);
        if (result.success) {
            _ytCachedInfo = result.data;

            // Show preview
            document.getElementById('ytThumbnail').src = result.data.thumbnail || '';
            document.getElementById('ytTitle').textContent = result.data.title;
            document.getElementById('ytAuthor').textContent = result.data.author;

            const dur = Number(result.data.duration);
            if (dur) {
                const m = Math.floor(dur / 60);
                const s = dur % 60;
                document.getElementById('ytDuration').textContent = `${m}:${String(s).padStart(2, '0')}`;
            }

            document.getElementById('youtubePreview').classList.remove('hidden');
            document.getElementById('youtubeEditFields').classList.remove('hidden');

            // Pre-fill editable fields
            document.getElementById('ytSongName').value = result.data.title;
            document.getElementById('ytArtist').value = result.data.author;

            document.getElementById('youtubeDownloadBtn').disabled = false;
            setYoutubeStatus('Ready to download!', 'success');
        } else {
            setYoutubeStatus(result.message || 'Failed to load info.', 'error');
        }
    } catch (err) {
        console.error('YouTube load error:', err);
        setYoutubeStatus('Error: ' + err.message, 'error');
    } finally {
        loadBtn.textContent = 'Load';
        loadBtn.disabled = false;
    }
}

async function handleYoutubeDownload() {
    const url = document.getElementById('youtubeUrlInput')?.value.trim();
    if (!url || !_ytCachedInfo) return;

    const songName = document.getElementById('ytSongName')?.value.trim() || _ytCachedInfo.title;
    const author = document.getElementById('ytArtist')?.value.trim() || _ytCachedInfo.author;

    const dlBtn = document.getElementById('youtubeDownloadBtn');
    dlBtn.textContent = 'Downloading…';
    dlBtn.disabled = true;
    setYoutubeStatus('Downloading & converting to MP3…', 'loading');

    try {
        const result = await window.electronAPI.downloadYoutubeAudio({ url, songName, author });
        if (result.success) {
            // Optionally add to active playlist
            if (activePlaylistId && activePlaylistId !== 'all-songs' && result.songId) {
                const playlists = loadPlaylists();
                const playlist = getPlaylistById(playlists, activePlaylistId);
                if (playlist) {
                    if (!playlist.songs) playlist.songs = [];
                    playlist.songs.push(result.songId);
                    savePlaylists(playlists);
                }
            }

            setYoutubeStatus('Song added successfully!', 'success');
            if (window.reloadSongsInPlayer) await window.reloadSongsInPlayer();

            // Reset YouTube UI after a short delay
            setTimeout(() => {
                _ytCachedInfo = null;
                document.getElementById('youtubePreview')?.classList.add('hidden');
                document.getElementById('youtubeEditFields')?.classList.add('hidden');
                document.getElementById('youtubeUrlInput').value = '';
                document.getElementById('youtubeStatus')?.classList.add('hidden');
                dlBtn.textContent = 'Download MP3';
                dlBtn.disabled = true;
            }, 1500);
        } else {
            setYoutubeStatus('Download failed: ' + result.message, 'error');
        }
    } catch (err) {
        console.error('YouTube download error:', err);
        setYoutubeStatus('Error: ' + err.message, 'error');
    } finally {
        dlBtn.textContent = 'Download MP3';
        dlBtn.disabled = !_ytCachedInfo;
    }
}

// ── Spotify helpers ──────────────────────────────────────────────────────────

function setSpotifyStatus(message, type) {
    const el = document.getElementById('spotifyStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `yt-status ${type}`; // loading | success | error
}

async function handleSpotifyLoad() {
    const input = document.getElementById('spotifyUrlInput');
    const url = input?.value.trim();
    if (!url) return;

    const loadBtn = document.getElementById('spotifyLoadBtn');
    loadBtn.textContent = 'Loading…';
    loadBtn.disabled = true;
    setSpotifyStatus('Fetching track info…', 'loading');
    _spCachedInfo = null;

    try {
        const result = await window.electronAPI.getSpotifyInfo(url);
        if (result.success) {
            _spCachedInfo = result.data;

            // Show preview
            document.getElementById('spThumbnail').src = result.data.thumbnail || '';
            document.getElementById('spTitle').textContent = result.data.title;
            document.getElementById('spArtist').textContent = result.data.artist;

            document.getElementById('spotifyPreview').classList.remove('hidden');
            document.getElementById('spotifyEditFields').classList.remove('hidden');

            // Pre-fill editable fields
            document.getElementById('spSongName').value = result.data.title;
            document.getElementById('spArtistName').value = result.data.artist;

            document.getElementById('spotifyDownloadBtn').disabled = false;
            setSpotifyStatus('Ready to download!', 'success');
        } else {
            setSpotifyStatus(result.message || 'Failed to load info.', 'error');
        }
    } catch (err) {
        console.error('Spotify load error:', err);
        setSpotifyStatus('Error: ' + err.message, 'error');
    } finally {
        loadBtn.textContent = 'Load';
        loadBtn.disabled = false;
    }
}

async function handleSpotifyDownload() {
    if (!_spCachedInfo) return;

    const songName = document.getElementById('spSongName')?.value.trim() || _spCachedInfo.title;
    const artist = document.getElementById('spArtistName')?.value.trim() || _spCachedInfo.artist;

    const dlBtn = document.getElementById('spotifyDownloadBtn');
    dlBtn.textContent = 'Downloading…';
    dlBtn.disabled = true;
    setSpotifyStatus('Searching & downloading from YouTube…', 'loading');

    try {
        const result = await window.electronAPI.downloadSpotifyAudio({
            songName,
            artist,
            thumbnailUrl: _spCachedInfo.thumbnailUrl
        });
        if (result.success) {
            // Optionally add to active playlist
            if (activePlaylistId && activePlaylistId !== 'all-songs' && result.songId) {
                const playlists = loadPlaylists();
                const playlist = getPlaylistById(playlists, activePlaylistId);
                if (playlist) {
                    if (!playlist.songs) playlist.songs = [];
                    playlist.songs.push(result.songId);
                    savePlaylists(playlists);
                }
            }

            setSpotifyStatus('Song added successfully!', 'success');
            if (window.reloadSongsInPlayer) await window.reloadSongsInPlayer();

            // Reset Spotify UI after a short delay
            setTimeout(() => {
                _spCachedInfo = null;
                document.getElementById('spotifyPreview')?.classList.add('hidden');
                document.getElementById('spotifyEditFields')?.classList.add('hidden');
                document.getElementById('spotifyUrlInput').value = '';
                document.getElementById('spotifyStatus')?.classList.add('hidden');
                dlBtn.textContent = 'Download MP3';
                dlBtn.disabled = true;
            }, 1500);
        } else {
            setSpotifyStatus('Download failed: ' + result.message, 'error');
        }
    } catch (err) {
        console.error('Spotify download error:', err);
        setSpotifyStatus('Error: ' + err.message, 'error');
    } finally {
        dlBtn.textContent = 'Download MP3';
        dlBtn.disabled = !_spCachedInfo;
    }
}

window.openAddSongModal = openAddSongModal;
window.closeAddSongModal = closeAddSongModal;
window.handleAddSong = handleAddSong;
window.toggleSettingsDropdown = toggleSettingsDropdown;
window.openCreatePlaylistModal = openCreatePlaylistModal;
window.closeCreatePlaylistModal = closeCreatePlaylistModal;
window.handleCreatePlaylist = handleCreatePlaylist;
window.switchAddSongTab = switchAddSongTab;
window.handleYoutubeLoad = handleYoutubeLoad;
window.handleYoutubeDownload = handleYoutubeDownload;
window.handleSpotifyLoad = handleSpotifyLoad;
window.handleSpotifyDownload = handleSpotifyDownload;

document.addEventListener('DOMContentLoaded', initStarterSidebar);