import discImg from '../../images/disc.png';

// Control icons
import backIcon from './images/back.png';
import nextIcon from './images/next.png';
import playIcon from './images/play-buttton.png';
import pauseIcon from './images/pause.png';
import muteIcon from './images/mute.png';
import unmuteIcon from './images/unmute.png';
import shuffleOffIcon from '../../images/shuffle.png';
import shuffleOnIcon from '../../images/shuffle N.png';
import loopingIcon from '../../images/looping.png';
import loop2Icon from '../../images/loop2.png';
import loopIndividualIcon from '../../images/loopindividual.png';

let now_playing;
let track_art;
let track_name;
let track_artist;
let playpause_btn;
let next_btn;
let prev_btn;
let seek_slider;
let volume_slider;
let mute_btn;
let curr_time;
let total_duration;
let wave;
let randomIcon;
let repeatIcon;
let curr_track = document.createElement('audio');
curr_track.crossOrigin = 'anonymous';

let track_index = 0;
let isPlaying = false;
let isRandom = false;
let loopState = 0; // 0: no loop, 1: loop all, 2: loop individual
let loopTrackIndex = null; // Track index for loop individual
let updateTimer;
let programmaticChange = false; // Flag to prevent double-triggers
let playlistQueueIds = null;
let playlistQueue = null;
let playlistQueuePosition = null;

// Audio state manager
const audioState = {
    volume: 50, // Default volume
    isMuted: false,
    previousVolume: 50
};

// Reactive audio state updates
function updateAudioState(newState, options = {}) {
    const { persistVolume = false } = options;

    Object.assign(audioState, newState);

    curr_track.volume = audioState.isMuted
        ? 0
        : audioState.volume / 100;

    programmaticChange = true;
    volume_slider.value = audioState.isMuted ? 0 : audioState.volume;
    updateRangeFill(volume_slider);
    programmaticChange = false;

    updateMuteButtonIcon();

    if (persistVolume) {
        window.electronAPI.setUserVolume(audioState.volume);
    }
}
// Default built-in songs (commented out - only custom songs will be used)
const default_music_list = [];

// Combined music list (will be populated with custom songs only)
let music_list = [];

function updateRangeFill(rangeEl) {
    if (!rangeEl) return;
    const min = Number(rangeEl.min || 0);
    const max = Number(rangeEl.max || 100);
    const val = Number(rangeEl.value || 0);
    const pct = ((val - min) * 100) / (max - min);

    // Filled track + remaining track
    rangeEl.style.background = `linear-gradient(90deg,
        rgba(255,255,255,0.92) 0%,
        rgba(255,255,255,0.92) ${pct}%,
        rgba(255,255,255,0.18) ${pct}%,
        rgba(255,255,255,0.18) 100%)`;
}

function loadTrack(track_index){
    clearInterval(updateTimer);
    
    // Stop any currently playing audio to prevent play/pause conflicts
    if (curr_track && !curr_track.paused) {
        curr_track.pause();
    }
    
    reset();

    // Check if music list has songs
    if (!music_list || music_list.length === 0) {
        console.error('No songs available to play');
        track_name.textContent = 'No songs loaded';
        track_artist.textContent = 'Please add songs first';
        return;
    }

    // Ensure track_index is valid
    if (track_index < 0 || track_index >= music_list.length) {
        track_index = 0;
    }

    const track = music_list[track_index];
    const filePath = track.filePath;
    
    // For custom songs, fetch via IPC; for default songs, use direct URL
    if (track.isCustom && filePath) {
        console.log('Loading custom track via IPC:', { index: track_index, path: filePath, name: track.name });
        window.electronAPI.getAudioFile(filePath).then(result => {
            if (result.success) {
                // Convert base64 to Blob
                const binaryString = atob(result.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'audio/mpeg' });
                const blobUrl = URL.createObjectURL(blob);
                
                curr_track.src = blobUrl;
                curr_track.load();
                console.log('✓ Custom track loaded via Blob URL:', blobUrl);
            } else {
                console.error('Failed to load audio file:', result.message);
            }
        }).catch(error => {
            console.error('Error fetching audio file:', error);
        });
    } else {
        // For default songs, use direct URL
        console.log('Loading track:', { index: track_index, url: track.music, name: track.name });
        curr_track.src = track.music;
        curr_track.load();
    }

    // Set background image
    if (track.isCustom && track.imagePath) {
        // Load custom image via IPC
        window.electronAPI.getImageFile(track.imagePath).then(result => {
            if (result.success) {
                // Convert base64 to Blob
                const binaryString = atob(result.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'image/jpeg' });
                const blobUrl = URL.createObjectURL(blob);
                track_art.style.backgroundImage = `url("${blobUrl}")`;
                console.log('✓ Custom image loaded via Blob URL');
            } else {
                console.error('Failed to load image:', result.message);
                track_art.style.backgroundImage = `url("${discImg}")`;
            }
        }).catch(error => {
            console.error('Error fetching image:', error);
            track_art.style.backgroundImage = `url("${discImg}")`;
        });
    } else {
        // Use default disc image
        track_art.style.backgroundImage = `url("${discImg}")`;
    }
    track_name.textContent = track.name;
    track_artist.textContent = track.artist;
    now_playing.textContent = "Playing music " + (track_index + 1) + " of " + music_list.length;

    updateTimer = setInterval(setUpdate, 1000);

    curr_track.addEventListener('ended', nextTrack);
    showPlayerBar();
    syncPlaylistQueuePosition();
}

function showPlayerBar() {
    const bar = document.getElementById('playerBar');
    if (bar) {
        bar.classList.remove('hidden');
        // Add bottom padding to the shell so content isn't hidden behind bar
        const shell = document.querySelector('.app-shell');
        if (shell) shell.classList.add('has-player');
    }
}

function syncPlaylistQueuePosition() {
    if (!playlistQueue || playlistQueue.length === 0) {
        playlistQueuePosition = null;
        return;
    }
    const position = playlistQueue.indexOf(track_index);
    playlistQueuePosition = position >= 0 ? position : null;
}


function reset(){
    curr_time.textContent = "00:00";
    total_duration.textContent = "00:00";
    programmaticChange = true;
    seek_slider.value = 0;
    updateRangeFill(seek_slider);
    programmaticChange = false;
}

function playpauseTrack(){
    isPlaying ? pauseTrack() : playTrack();
}

function playTrack(){
    if (!music_list || music_list.length === 0) {
        console.error('No songs to play');
        return;
    }
    
    // Only attempt to play if audio source is set and ready
    if (!curr_track.src) {
        console.warn('Audio source not set');
        return;
    }
    
    console.log('Playing track:', { index: track_index, url: curr_track.src, readyState: curr_track.readyState });
    const playPromise = curr_track.play();
    if (playPromise !== undefined) {
        playPromise.catch((error) => {
            // Ignore AbortError - it's harmless and happens during rapid play/pause
            if (error.name !== 'AbortError') {
                console.error('Error playing track:', error);
            }
        });
    }
    isPlaying = true;
    playpause_btn.style.backgroundImage = `url("${pauseIcon}")`;
    wave.classList.add('loader');
    if (track_art) {
        track_art.classList.add('spinning');
        track_art.classList.remove('spinning-paused');
    }
}

function pauseTrack(){
    curr_track.pause();
    isPlaying = false;
    playpause_btn.style.backgroundImage = `url("${playIcon}")`;
    wave.classList.remove('loader');
    if (track_art) {
        track_art.classList.add('spinning');
        track_art.classList.add('spinning-paused');
    }
}

function nextTrack(){
    // If loop individual is active, just replay the current track
    if (loopState === 2) {
        window._autoplayRequested = true;
        loadTrack(track_index);
        return;
    }

    if (playlistQueue && playlistQueue.length > 0) {
        if (isRandom) {
            const random_index = Math.floor((Math.random() * playlistQueue.length));
            track_index = playlistQueue[random_index];
            playlistQueuePosition = random_index;
        } else {
            if (playlistQueuePosition === null) {
                syncPlaylistQueuePosition();
            }
            if (playlistQueuePosition === null) {
                playlistQueuePosition = 0;
            } else if (playlistQueuePosition < playlistQueue.length - 1) {
                playlistQueuePosition += 1;
            } else {
                playlistQueuePosition = 0;
            }
            track_index = playlistQueue[playlistQueuePosition];
        }
    } else {
        if(track_index < music_list.length - 1 && isRandom === false){
            track_index += 1;
        }
        else if(isRandom === true){
            let random_index = Math.floor((Math.random() * music_list.length));
            track_index = random_index;
        }
        else{
            track_index = 0;
        }
    }
    // Set autoplay flag so the song will play when it's ready
    window._autoplayRequested = true;
    loadTrack(track_index);
}

function prevTrack(){
    if (playlistQueue && playlistQueue.length > 0) {
        if (isRandom) {
            const random_index = Math.floor((Math.random() * playlistQueue.length));
            track_index = playlistQueue[random_index];
            playlistQueuePosition = random_index;
        } else {
            if (playlistQueuePosition === null) {
                syncPlaylistQueuePosition();
            }
            if (playlistQueuePosition === null) {
                playlistQueuePosition = 0;
            } else if (playlistQueuePosition > 0) {
                playlistQueuePosition -= 1;
            } else {
                playlistQueuePosition = playlistQueue.length - 1;
            }
            track_index = playlistQueue[playlistQueuePosition];
        }
    } else {
        if(track_index > 0){
            track_index -= 1;
        }
        else{
            track_index = music_list.length - 1;
        }
    }
    // Set autoplay flag so the song will play when it's ready
    window._autoplayRequested = true;
    loadTrack(track_index);
}

function seekTo(){
    // Check if duration is a valid finite number
    if (!isFinite(curr_track.duration)) {
        console.warn('Cannot seek: track duration is not yet loaded or invalid');
        return;
    }
    let seekto = curr_track.duration * (seek_slider.value / 100);
    if (isFinite(seekto)) {
        curr_track.currentTime = seekto;
    }
}

function setVolume(){
    // This function is no longer needed - volume changes are handled directly in toggleMute() and volume slider input listener
}

function toggleMute() {
    console.log(`🔊 Mute clicked — volume: ${audioState.volume}`);
    if (audioState.isMuted) {
        const restoredVolume = audioState.previousVolume > 0
            ? audioState.previousVolume
            : 50;
        updateAudioState({
            isMuted: false,
            volume: restoredVolume
        }, { persistVolume: true });
    } else {
        const prev = audioState.volume > 0 ? audioState.volume : audioState.previousVolume;
        updateAudioState({
            isMuted: true,
            previousVolume: prev,
            volume: 0
        });
    }
}

function updateMuteButtonIcon() {
    mute_btn.style.backgroundImage =
        audioState.isMuted || audioState.volume === 0
            ? `url("${muteIcon}")`
            : `url("${unmuteIcon}")`;
}

function setUpdate(){
    let seekbar_value = (curr_track.currentTime / curr_track.duration) * 100;
    if (isNaN(seekbar_value)) seekbar_value = 0;
    programmaticChange = true;
    seek_slider.value = seekbar_value;
    updateRangeFill(seek_slider);
    programmaticChange = false;
    updateMuteButtonIcon();

    let ct_minutes = Math.floor(curr_track.currentTime / 60);
    let ct_seconds = Math.floor(curr_track.currentTime - ct_minutes * 60);
    let duration_minutes = Math.floor(curr_track.duration / 60);
    let duration_seconds = Math.floor(curr_track.duration - duration_minutes * 60);

    if(isNaN(duration_minutes) || isNaN(duration_seconds)){
        total_duration.textContent = "00:00";
    }
    else{
        if(ct_minutes < 10) {ct_minutes = "0" + ct_minutes;}
        if(ct_seconds < 10) {ct_seconds = "0" + ct_seconds;}
        if(duration_minutes < 10) {duration_minutes = "0" + duration_minutes;}
        if(duration_seconds < 10) {duration_seconds = "0" + duration_seconds;}

        curr_time.textContent = ct_minutes + ":" + ct_seconds;
        total_duration.textContent = duration_minutes + ":" + duration_seconds;
    }

    updateRangeFill(seek_slider);
}

function repeatTrack(){
    // Cycle through loop states: 0 (no loop) -> 1 (loop all) -> 2 (loop individual) -> 0
    loopState = (loopState + 1) % 3;
    if (loopState === 2) {
        loopTrackIndex = track_index; // Set the track to loop
    } else {
        loopTrackIndex = null;
    }
    updateLoopIcon();
}

function randomTrack(){
    isRandom = isRandom ? false : true;
    updateShuffleIcon();
}

function updateShuffleIcon() {
    if (!randomIcon) return;
    randomIcon.style.backgroundImage = `url("${isRandom ? shuffleOnIcon : shuffleOffIcon}")`;
}

function updateLoopIcon() {
    if (!repeatIcon) return;
    let iconUrl;
    switch (loopState) {
        case 1:
            iconUrl = loop2Icon; // Loop all
            break;
        case 2:
            iconUrl = loopIndividualIcon; // Loop individual
            break;
        default:
            iconUrl = loopingIcon; // No loop
    }
    repeatIcon.style.backgroundImage = `url("${iconUrl}")`;
}

// Load custom songs from database
async function loadCustomSongs() {
    try {
        const customSongs = await window.electronAPI.getAllSongs();
        // Reset to default songs
        music_list = [...default_music_list];
        
        // Add custom songs
        if (customSongs && customSongs.length > 0) {
            customSongs.forEach(song => {
                if (song.file_path) {
                    music_list.push({
                        id: song.id,
                        imagePath: song.image_path,  // Store image file path separately
                        name: song.name,
                        artist: song.author || 'Unknown Artist',
                        music: song.file_path,  // Store actual file path, not URL
                        filePath: song.file_path,  // Also store for reference
                        isCustom: true
                    });
                }
            });
            console.log(`✓ Loaded ${customSongs.length} custom songs`);
        }
    } catch (error) {
        console.error('Failed to load custom songs:', error);
    }
    rebuildPlaylistQueue();
}

function buildPlaylistQueueFromIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
        return null;
    }
    const indexMap = new Map(music_list.map((song, index) => [song.id, index]));
    const indices = ids.map((id) => indexMap.get(id)).filter((index) => Number.isInteger(index));
    return indices.length ? indices : null;
}

function setPlaylistQueue(ids) {
    playlistQueueIds = Array.isArray(ids) ? ids.slice() : null;
    playlistQueue = buildPlaylistQueueFromIds(playlistQueueIds);
    playlistQueuePosition = null;
}

function rebuildPlaylistQueue() {
    if (!playlistQueueIds || playlistQueueIds.length === 0) {
        playlistQueue = null;
        playlistQueuePosition = null;
        return;
    }
    playlistQueue = buildPlaylistQueueFromIds(playlistQueueIds);
    syncPlaylistQueuePosition();
}

// Reload songs in player (called after adding a new song)
async function reloadSongsInPlayer() {
    await loadCustomSongs();
    rebuildPlaylistQueue();
    
    // Always notify about song updates (for starter page UI refresh)
    if (window.onPlayerSongsUpdated) {
        window.onPlayerSongsUpdated();
    }
    
    // Only reload track if player has been initialized
    if (track_name && track_artist && now_playing) {
        track_index = 0;
        loadTrack(track_index);
        console.log('✓ Songs reloaded');
    } else {
        console.warn('Player not yet initialized, songs will load when player is opened');
    }
}

export function initPlayer(autoPlay = false) {
    // Get all DOM elements - scoped to #playerBar (bottom bar)
    const playerBar = document.getElementById('playerBar');
    if (!playerBar) {
        console.error("Player bar element not found");
        return;
    }
    now_playing = playerBar.querySelector(".now-playing");
    track_art = playerBar.querySelector(".track-art");
    track_name = playerBar.querySelector(".track-name");
    track_artist = playerBar.querySelector(".track-artist");
    playpause_btn = playerBar.querySelector(".playpause-track");
    next_btn = playerBar.querySelector(".next-track");
    prev_btn = playerBar.querySelector(".prev-track");
    seek_slider = playerBar.querySelector(".seek_slider");
    volume_slider = playerBar.querySelector(".volume_slider");
    mute_btn = playerBar.querySelector(".mute-track");
    curr_time = playerBar.querySelector(".current-time");
    total_duration = playerBar.querySelector(".total-duration");
    wave = playerBar.querySelector("#wave");
    randomIcon = playerBar.querySelector(".random-track");
    repeatIcon = playerBar.querySelector(".repeat-track");

    // Check if elements were found
    if (!track_art || !track_name || !track_artist) {
        console.error("Player elements not found");
        return;
    }

    // Remember if autoplay was requested by caller
    window._autoplayRequested = !!autoPlay;

    // Remove old event listeners to prevent duplicates
    if (window._audioErrorHandler) {
        curr_track.removeEventListener('error', window._audioErrorHandler);
    }
    if (window._audioCanplayHandler) {
        curr_track.removeEventListener('canplay', window._audioCanplayHandler);
    }

    // Set up audio element error handling
    window._audioErrorHandler = (e) => {
        console.error('Audio error:', e.target.error, curr_track.src);
    };
    curr_track.addEventListener('error', window._audioErrorHandler);

    // When audio can play, if autoplay was requested, start playback
    window._audioCanplayHandler = () => {
        console.log('✓ Audio can play:', curr_track.src);
        if (window._autoplayRequested) {
            // Attempt to play and then clear the flag
            playTrack();
            window._autoplayRequested = false;
        }
    };
    curr_track.addEventListener('canplay', window._audioCanplayHandler);

    // Set control button background images
    if (prev_btn) {
        prev_btn.style.backgroundImage = `url("${backIcon}")`;
    }
    if (next_btn) {
        next_btn.style.backgroundImage = `url("${nextIcon}")`;
    }
    if (playpause_btn) {
        playpause_btn.style.backgroundImage = `url("${playIcon}")`;
    }
    if (mute_btn) {
        mute_btn.style.backgroundImage = `url("${unmuteIcon}")`;
        mute_btn.addEventListener('click', toggleMute);
    }
    if (randomIcon) {
        randomIcon.style.backgroundPosition = 'center';
        randomIcon.style.backgroundRepeat = 'no-repeat';
        randomIcon.style.backgroundSize = '58%';
        updateShuffleIcon();
    }
    if (repeatIcon) {
        repeatIcon.style.backgroundPosition = 'center';
        repeatIcon.style.backgroundRepeat = 'no-repeat';
        repeatIcon.style.backgroundSize = '58%';
        updateLoopIcon();
    }

    // Add event listener for range slider updates
    if (seek_slider) {
        seek_slider.addEventListener('input', () => updateRangeFill(seek_slider));
        seek_slider.addEventListener('change', () => {
            if (!programmaticChange) {
                seekTo();
            }
        });
        // Initialize slider fill
        updateRangeFill(seek_slider);
    }
    if (volume_slider) {
        // Live volume update (no DB writes)
        volume_slider.addEventListener('input', () => {
            if (programmaticChange) return;

            const vol = Number(volume_slider.value);
            updateAudioState({
                volume: vol,
                isMuted: vol === 0,
                previousVolume: vol > 0 ? vol : audioState.previousVolume
            });
        });

        // Save volume ONLY on mouse release
        volume_slider.addEventListener('change', () => {
            const vol = Number(volume_slider.value);
            updateAudioState({
                volume: vol,
                isMuted: vol === 0,
                previousVolume: vol > 0 ? vol : audioState.previousVolume
            }, { persistVolume: true });
        });

        // Load saved volume once
        window.electronAPI.getUserVolume()
            .then((savedVolume) => {
                updateAudioState({
                    volume: savedVolume,
                    isMuted: savedVolume === 0,
                    previousVolume: savedVolume > 0 ? savedVolume : audioState.previousVolume
                });
            })
            .catch(() => {
                updateAudioState({
                    volume: 50,
                    isMuted: false,
                    previousVolume: 50
                });
            });
    }


    // Load custom songs from database
    loadCustomSongs().then(() => {
        // Load first track
        loadTrack(track_index);
        // Update slider fill after loading track
        if (seek_slider) updateRangeFill(seek_slider);
        if (window.onPlayerSongsUpdated) {
            window.onPlayerSongsUpdated();
        }
    });

    rebuildPlaylistQueue();

// Make functions globally accessible for onclick handlers
window.randomTrack = randomTrack;
window.prevTrack = prevTrack;
window.playpauseTrack = playpauseTrack;
window.nextTrack = nextTrack;
window.repeatTrack = repeatTrack;
window.seekTo = seekTo;
window.setVolume = setVolume;
window.playTrack = playTrack;
window.pauseTrack = pauseTrack;
window.toggleMute = toggleMute;
window.reloadSongsInPlayer = reloadSongsInPlayer;
window.getPlayerSongs = () => music_list;
window.setPlaylistQueue = setPlaylistQueue;
window.playSongById = (songId, queueIds) => {
    if (queueIds) {
        setPlaylistQueue(queueIds);
    }
    const index = music_list.findIndex((song) => song.id === songId);
    if (index >= 0) {
        track_index = index;
        syncPlaylistQueuePosition();
        window._autoplayRequested = true;
        loadTrack(track_index);
    }
};
}
