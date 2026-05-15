// client/app.js - YOUR LATEST CODE + DYNAMIC PROMPTS FEATURE

const API_URL = 'https://echoes-server.cheezfish.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

// --- CONFIG & ICONS ---
const MAX_RECORDING_SECONDS = 60;
const INTERACTION_RANGE_METERS = 100; // The close-range for listening
const ECHO_LIFESPAN_MS = 20 * 24 * 60 * 60 * 1000;
const centralEchoIconUrl = "https://api.iconify.design/material-symbols:graphic-eq.svg";
const userLocationIcon = L.divIcon({
    className: 'user-location-marker',
    html: `<div class="pulse"></div><img src="https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff"/>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

// --- GLOBAL STATE ---
let map, markers, userMarker, mediaRecorder;
let audioChunks = [];
let loggedInUser = null, currentUserPosition = null, currentBucketKey = "";
let echoMarkersMap = new Map();
let currentEchoesInView = [];
let highlightedEchoId = null;
let locationWatcherId = null;
let fetchTimeout = null;
let recordingTimer;
let isUserInVicinity = false;

// --- NEW: DYNAMIC PROMPT STATE ---
let promptInterval = null;
const promptMessages = [
    // --- Direct & Place-Specific ---
    "What does this specific spot mean to you right now?",
    "Leave a message for the next person who stands right here.",
    "Describe what you see from this exact vantage point.",
    "Add your voice to the history of this place.",
    "If these walls could talk, what would you want them to say?",
    "What memory does this location bring to mind?",
    "Dedicate this echo to this street, this park, this corner.",

    // --- Sensory & Environmental ---
    "What can you smell? Describe it.",
    "Close your eyes. What is the most prominent sound you hear?",
    "Is the energy of this place calm, or chaotic? Capture it.",
    "Record a message that matches the weather right now.",
    "Let the sounds of this location be the backing track to your thought.",

    // --- Anonymous Interaction with Place ---
    "Leave a secret here that only this location will ever know.",
    "If you were to hide a treasure here, what would it be? Describe it.",
    "Give this place a new, secret name.",
    "What advice would you give to someone visiting this spot for the first time?",
    "Share a hope for the future of this place.",

        // --- Personal & Reflective, Tied to Place ---
    "How does being here make you feel in one word? Say it.",
    "What brought you here today?",
    "Leave a piece of your personal story in this location.",
    "Imagine you are a ghost tied to this spot. What do you whisper to passersby?",
    "What's a thought that could only have happened here?",

    // --- The Direct Invitation ---
    "Leave a message for the next person who stands here.",
    "What do you want to tell the world today?",
    "Your voice can travel through time. What will it say?",
    "Someone, somewhere, will hear this. Speak to them.",
    "This is your mark on the world. Make it count.",

    // --- The Introspective & Vulnerable ---
    "Share a thought. A secret. A hope.",
    "What's a piece of advice you wish you'd received?",
    "Admit a small, harmless truth.",
    "What's on your mind in this exact moment?",
    "Whisper a dream you've never said out loud.",

    // --- The Creative & Playful ---
    "Sing the first line of a song that's in your head.",
    "Tell a one-sentence story about this place.",
    "Describe the color of the sky without using its name.",
    "Recite a line from your favorite poem or movie.",
    "Make a sound that represents your current mood.",

    // --- The Kind & Uplifting ---
    "Turn a stranger's day around. Leave some kindness.",
    "Offer a word of encouragement to whoever finds this.",
    "Remind someone that they're doing a good job.",
    "Share something that made you smile today.",
    "Leave a message of hope.",

    // --- The Philosophical & Grand ---
    "Leave a piece of your story in this place.",
    "If you could ask the future one question, what would it be?",
    "What does it mean to be here, right now?",
    "Add your voice to the history of this spot.",
    "What is a truth you've learned the hard way?"
];
const recordingMessages = [
    // --- Confirmation & Connection ---
    "Your voice, traveling.",
    "Someone will find this.",
    "A perfect transmission.",
    "Sending it out into the world.",

    // --- Affirmation & Value ---
    "This is a gift.",
    "Leaving your mark.",
    "A true echo.",
    "This is a good one.",
    "A future memory.",
    
    // --- Poetic & Abstract ---
    "A message in a bottle for the future.",
    "Etching this into time.",
    "The aether is listening.",
    "A beautiful waveform.",
    "History is being recorded.",
    "An echo bound to the earth.",
    "A memory anchored in time and space.",
    "Part of the landscape now.",

        // --- Grounding & Locational ---
    "This spot will remember this.",
    "Tying your voice to this coordinate.",
    "This location now holds your echo.",
    "A perfect location lock.",
    "Imprinting this moment.",
    "This place is listening.",

    // --- Connection & Transmission ---
    "Someone will stand here and listen.",
    "Sending it out from this point.",
    "Your mark is being made.",
    "A future discovery awaits.",
    "A ghost in the machine.",
    
];

// --- UI ELEMENT CACHE ---
let loginBtn, welcomeMessage, loggedOutView, loggedInView, userPillBtn, userAvatar, userMenuDropdown, toastContainer, contextActionBtn, nearbyEchoesList, bottomSheet, sheetSummary, authModal, authForm, modalError, usernameInput, passwordInput, modalTitle, modalSubmitBtn;

// Helper to format seconds into MM:SS
const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

/** Safely builds a Leaflet popup element — no innerHTML with user data */
function buildPopupEl(echo, isWithinInteractionRange, distanceToUser, userLatLng) {
    if (isWithinInteractionRange) {
        const wrap = document.createElement('div');
        const h3 = document.createElement('h3');
        h3.textContent = echo.location_name || 'An Echo';
        const p = document.createElement('p');
        const author = echo.username ? `by ${echo.username}` : 'by an anonymous user';
        p.textContent = `Recorded on: ${new Date(echo.created_at).toLocaleDateString()} ${author}`;
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = echo.audio_url;
        audio.addEventListener('play', () => window.keepEchoAlive(echo.id));
        wrap.appendChild(h3);
        wrap.appendChild(p);
        wrap.appendChild(audio);
        return wrap;
    } else {
        const distanceDisplay = distanceToUser < 1000
            ? `${Math.round(distanceToUser)}m`
            : `${(distanceToUser / 1000).toFixed(1)}km`;
        const message = userLatLng
            ? `Get within 100m to listen. (Currently ${distanceDisplay} away)`
            : `Find your location to interact with echoes.`;
        const wrap = document.createElement('div');
        wrap.className = 'distant-popup';
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message';
        msgDiv.textContent = 'Too far to hear...';
        const distDiv = document.createElement('div');
        distDiv.className = 'distance';
        distDiv.textContent = message;
        wrap.appendChild(msgDiv);
        wrap.appendChild(distDiv);
        return wrap;
    }
}

/** Creates the dynamic "health ring" icon */
function createHealthIcon(healthPercent, isHighlighted = false) {
    const size = isHighlighted ? 48 : 40;
    const strokeWidth = isHighlighted ? 4 : 3;
    const radius = (size / 2) - (strokeWidth / 2);
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (healthPercent / 100) * circumference;
    let ringColor;
    if (isHighlighted) ringColor = '#ff5733';
    else if (healthPercent > 66) ringColor = '#ffc107';
    else if (healthPercent > 33) ringColor = '#007bff';
    else ringColor = '#6c757d';
    const html = `<div class="health-icon-container" style="width:${size}px; height:${size}px;"><svg class="health-icon-svg" viewBox="0 0 ${size} ${size}"><circle class="health-ring-bg" cx="${size/2}" cy="${size/2}" r="${radius}"></circle><circle class="health-ring-fg" cx="${size/2}" cy="${size/2}" r="${radius}" stroke="${ringColor}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle></svg><img class="health-icon-inner" src="${centralEchoIconUrl}?color=${ringColor}" alt="Echo"></div>`;
    return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

document.addEventListener('DOMContentLoaded', () => {
    loginBtn = document.getElementById("login-btn");
    welcomeMessage = document.getElementById("welcome-message");
    loggedOutView = document.getElementById("logged-out-view");
    loggedInView = document.getElementById("logged-in-view");
    userPillBtn = document.getElementById("user-pill-btn");
    userAvatar = document.getElementById("user-avatar");
    userMenuDropdown = document.getElementById("user-menu-dropdown");
    toastContainer = document.getElementById("toast-container");
    contextActionBtn = document.getElementById("context-action-btn");
    nearbyEchoesList = document.getElementById("nearby-echoes-list");
    bottomSheet = document.getElementById("bottom-sheet");
    sheetSummary = document.getElementById("sheet-summary");
    authModal = document.getElementById("auth-modal");
    authForm = document.getElementById("auth-form");
    modalError = document.getElementById("modal-error");
    usernameInput = document.getElementById("username");
    passwordInput = document.getElementById("password");
    modalTitle = document.getElementById("modal-title");
    modalSubmitBtn = document.getElementById("modal-submit-btn");
    initializeApp();
});

function initBottomSheet() {
    const handleArea = document.getElementById('sheet-handle-area');
    let startY = 0, moved = false;
    handleArea.addEventListener('touchstart', e => { startY = e.touches[0].clientY; moved = false; }, { passive: true });
    handleArea.addEventListener('touchmove', e => { moved = Math.abs(e.touches[0].clientY - startY) > 10; }, { passive: true });
    handleArea.addEventListener('touchend', e => {
        if (moved) {
            const dy = e.changedTouches[0].clientY - startY;
            if (dy > 30) { bottomSheet && bottomSheet.classList.remove('expanded'); document.body.classList.remove('sheet-expanded'); }
            else if (dy < -30) { bottomSheet && bottomSheet.classList.add('expanded'); document.body.classList.add('sheet-expanded'); }
        }
    });
}

function initializeApp() {
    setupEventListeners();
    initBottomSheet();
    checkLoginState();
    map = L.map('map', { zoomControl: true, attributionControl: false }).setView([20, 0], 2);
    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=oeJYklnaUPpZgpHgTszf', { maxZoom: 20, attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    L.control.attribution({ position: 'topright' }).addTo(map);
    markers = L.markerClusterGroup({ disableClusteringAtZoom: 15 });
    map.addLayer(markers);
    map.on('movestart', () => { isUserInVicinity = false; updateActionButtonState(); });
    map.on('moveend', () => {
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(() => {
            if (map.getZoom() > 12) fetchEchoesForCurrentView();
            else { clearNearbyListAndMarkers(); updateStatus("Zoom in further to discover echoes.", "info", 0); }
        }, 500);
    });
}

function setupEventListeners() {
    loginBtn.addEventListener('click', () => openModal('login'));
    contextActionBtn.addEventListener('click', handleContextActionClick);
    if (userPillBtn) userPillBtn.addEventListener('click', toggleUserMenu);
    const closeMenuOnOutsideClick = (e) => {
        if (userMenuDropdown && userPillBtn && !userPillBtn.contains(e.target) && !userMenuDropdown.contains(e.target)) {
            userMenuDropdown.style.display = 'none';
        }
    };
    window.addEventListener('click', closeMenuOnOutsideClick);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('sheet-handle-area').addEventListener('click', toggleSheet);
    authModal.querySelector('.close-btn').addEventListener('click', () => authModal.style.display = 'none');
    authModal.addEventListener('click', e => { if (e.target === authModal) authModal.style.display = 'none'; });
    authForm.addEventListener('submit', handleAuthFormSubmit);
}

// --- CORE UI MANAGEMENT ---
function updateActionButtonState() {
    if (!contextActionBtn) return;
    contextActionBtn.classList.remove('is-recording');
    let isRecording = mediaRecorder && mediaRecorder.state === 'recording';
    
    // Stop prompts before determining the new state, unless we're about to start them again.
    if (!(isUserInVicinity && loggedInUser && !isRecording)) {
        stopPromptCycling();
    }

    if (isRecording) {
        contextActionBtn.className = 'is-recording';
        let secondsLeft = Math.max(0, Math.round((recordingTimer.targetTime - Date.now()) / 1000));
        contextActionBtn.innerHTML = `<span>Stop (${secondsLeft}s)</span>`;
    } else if (isUserInVicinity && loggedInUser) {
        contextActionBtn.className = 'record';
        contextActionBtn.title = 'Record an Echo';
        contextActionBtn.innerHTML = `<img src="https://api.iconify.design/material-symbols:mic.svg?color=white" alt="Record"> <span>Record</span>`;
        startPromptCycling();
    } else {
        contextActionBtn.className = 'find-me';
        contextActionBtn.title = 'Find My Location';
        contextActionBtn.innerHTML = `<img src="https://api.iconify.design/material-symbols:my-location.svg?color=white" alt="Find Me">`;
        
        // MODIFIED: Set the default status using the new fade-in function
        if (loggedInUser) {
            updateStatus(`Welcome, ${loggedInUser}!`, '', 0); // Use default style, not 'info'
        } else {
            updateStatus("Click the compass to explore your area.", '', 0);
        }
    }
}

function handleContextActionClick() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    } else if (isUserInVicinity && loggedInUser) {
        handleRecordClick();
    } else {
        handleFindMeClick();
    }
}

function toggleUserMenu() { userMenuDropdown.style.display = userMenuDropdown.style.display === 'block' ? 'none' : 'block'; }
function toggleSheet() {
    if (!bottomSheet) return;
    bottomSheet.classList.toggle('expanded');
    document.body.classList.toggle('sheet-expanded', bottomSheet.classList.contains('expanded'));
}

function showToast(message, type = '', duration = 4000) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast${type ? ' ' + type : ''}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

function updateStatus(message, type = '', duration = 4000) {
    if (duration === 0) {
        if (sheetSummary) sheetSummary.textContent = message;
        return;
    }
    showToast(message, type, duration);
}

// --- NEW PROMPT CYCLING FUNCTIONS ---
/**
 * Starts cycling through helpful prompts in the status bar.
 */
function startPromptCycling() {
    if (promptInterval) return;

    let currentIndex = Math.floor(Math.random() * promptMessages.length);
    
    // Immediately show the first prompt (will fade in via updateStatus)
    updateStatus(promptMessages[currentIndex], 'info', 0);

    // MODIFIED: Increased interval for slower discovery
    promptInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % promptMessages.length;
        updateStatus(promptMessages[currentIndex], 'info', 0);
    }, 15000); // Change prompt every 15 seconds
}

function stopPromptCycling() {
    clearInterval(promptInterval);
    promptInterval = null;
}

// --- INTERACTIVITY FUNCTIONS ---
// --- Find and replace the fetchEchoesForCurrentView function ---
async function fetchEchoesForCurrentView() {
    // 1. Get the map's current visible bounding box
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    updateStatus("Scanning for echoes...", "info");

    try {
        // 2. Build the new URL with the corner coordinates
        const url = new URL(`${API_URL}/echoes`);
        url.searchParams.append('sw_lng', sw.lng);
        url.searchParams.append('sw_lat', sw.lat);
        url.searchParams.append('ne_lng', ne.lng);
        url.searchParams.append('ne_lat', ne.lat);

        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error("Server could not fetch echoes.");
        
        currentEchoesInView = await response.json();
        
        // The rest of the logic works perfectly with this data
        renderMapMarkers(currentEchoesInView);
        renderNearbyList(currentEchoesInView);
        
        // Update the status based on what was returned for this view
        if (currentEchoesInView.length > 0) {
            updateStatus(`${currentEchoesInView.length} signals detected in this area.`, "success");
        } else {
            updateStatus("This area is quiet.", "info", 0);
        }
    } catch (err) {
        updateStatus("Could not fetch echoes.", "error");
        console.error("Fetch Echoes Error:", err);
    }
}

function renderNearbyList(echoes) {
    nearbyEchoesList.innerHTML = '';

    if (echoes.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-message';
        p.textContent = currentUserPosition ? 'No echoes in this area.' : 'Find your location to discover echoes.';
        nearbyEchoesList.appendChild(p);
        updateStatus('Explore the map', '', 0);
        return;
    }

    const sorted = [...echoes].sort((a, b) => (a.distance_meters || Infinity) - (b.distance_meters || Infinity));
    const nearby = sorted.filter(e => (e.distance_meters || Infinity) <= INTERACTION_RANGE_METERS);

    const countText = `${sorted.length} echo${sorted.length !== 1 ? 's' : ''} in view${nearby.length > 0 ? ` · ${nearby.length} within range` : ''}`;
    updateStatus(countText, '', 0);

    sorted.forEach(echo => {
        const withinRange = (echo.distance_meters || Infinity) <= INTERACTION_RANGE_METERS;

        const item = document.createElement('div');
        item.className = `echo-row${withinRange ? ' in-range' : ''}`;
        item.dataset.echoId = echo.id;

        const topRow = document.createElement('div');
        topRow.className = 'echo-row-top';

        const distBadge = document.createElement('span');
        distBadge.className = 'dist-badge';
        if (!currentUserPosition || echo.distance_meters === Infinity) {
            distBadge.textContent = '—';
        } else if (echo.distance_meters < 1000) {
            distBadge.textContent = `${Math.round(echo.distance_meters)}m`;
            if (withinRange) distBadge.classList.add('near');
        } else {
            distBadge.textContent = `${(echo.distance_meters / 1000).toFixed(1)}km`;
        }

        const mainCol = document.createElement('div');
        mainCol.className = 'echo-row-main';

        const nameEl = document.createElement('span');
        nameEl.className = 'echo-row-name';
        nameEl.textContent = echo.location_name || 'Unnamed place';

        const metaEl = document.createElement('span');
        metaEl.className = 'echo-row-meta';
        const author = echo.username || 'anonymous';
        const date = new Date(echo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        metaEl.textContent = `${author} · ${date}`;

        mainCol.appendChild(nameEl);
        mainCol.appendChild(metaEl);

        const rightCol = document.createElement('span');
        rightCol.className = 'echo-row-right';
        rightCol.textContent = formatTime(echo.duration_seconds);

        topRow.appendChild(distBadge);
        topRow.appendChild(mainCol);
        topRow.appendChild(rightCol);
        item.appendChild(topRow);

        if (withinRange) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.preload = 'none';
            audio.src = echo.audio_url;
            audio.onplay = () => window.keepEchoAlive(echo.id);
            item.appendChild(audio);
        }

        item.addEventListener('click', (e) => {
            if (!e.target.closest('audio')) handleListItemClick(echo.id);
        });

        nearbyEchoesList.appendChild(item);
    });
}

// --- Find and replace the renderMapMarkers function ---
function renderMapMarkers(echoes) {
    markers.clearLayers();
    echoMarkersMap.clear();

    if (!currentUserPosition) {
        // If we don't know the user's location, we can't calculate distance.
        // Treat all echoes as distant for now.
        console.warn("Cannot calculate true distance; currentUserPosition is not set.");
    }
    const userLatLng = currentUserPosition ? L.latLng(currentUserPosition.lat, currentUserPosition.lng) : null;

    echoes.forEach(echo => {
        if (!echo.lat || !echo.lng) return;

        const echoLatLng = L.latLng(echo.lat, echo.lng);
        
        // --- NEW: Client-side distance calculation ---
        // Calculate distance from the USER's actual position, not the map center.
        const distanceToUser = userLatLng ? userLatLng.distanceTo(echoLatLng) : Infinity;
        const isWithinInteractionRange = distanceToUser <= INTERACTION_RANGE_METERS;
        
        // Add this new property to the echo object for use in the list renderer.
        echo.distance_meters = distanceToUser;

        const popupEl = buildPopupEl(echo, isWithinInteractionRange, distanceToUser, userLatLng);

        const ageMs = new Date() - new Date(echo.last_played_at);
        let healthPercent = Math.max(0, 100 * (1 - (ageMs / ECHO_LIFESPAN_MS)));
        const healthIcon = createHealthIcon(healthPercent, echo.id === highlightedEchoId);

        const marker = L.marker(echoLatLng, { icon: healthIcon });
        marker.bindPopup(popupEl);

        if (!isWithinInteractionRange) {
            marker.on('add', function() {
                 if (this._icon) L.DomUtil.addClass(this._icon, 'distant-echo');
            });
        }
        
        marker.on('click', () => handleMarkerClick(echo.id));
        echoMarkersMap.set(echo.id, marker);
        markers.addLayer(marker);
    });
}

function handleListItemClick(echoId) { const marker = echoMarkersMap.get(echoId); if (marker) { map.flyTo(marker.getLatLng(), map.getZoom() < 16 ? 16 : map.getZoom()); highlightEcho(echoId); } }
function handleMarkerClick(echoId) {
    if (bottomSheet) { bottomSheet.classList.add('expanded'); document.body.classList.add('sheet-expanded'); }
    const listItem = nearbyEchoesList.querySelector(`.echo-row[data-echo-id='${echoId}']`);
    if (listItem) { listItem.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlightEcho(echoId); }
}

function highlightEcho(echoId) {
    if (highlightedEchoId === echoId) return;
    if (highlightedEchoId) {
        const prevItem = nearbyEchoesList.querySelector(`.echo-row[data-echo-id='${highlightedEchoId}']`);
        if (prevItem) prevItem.classList.remove('highlighted');
        const prevMarker = echoMarkersMap.get(highlightedEchoId);
        if (prevMarker) {
            const prevEcho = currentEchoesInView.find(e => e.id === highlightedEchoId);
            if (prevEcho) {
                const ageMs = new Date() - new Date(prevEcho.last_played_at);
                let healthPercent = Math.max(0, 100 * (1 - (ageMs / ECHO_LIFESPAN_MS)));
                prevMarker.setIcon(createHealthIcon(healthPercent, false));
                prevMarker.setZIndexOffset(0);
            }
        }
    }
    const newItem = nearbyEchoesList.querySelector(`.echo-row[data-echo-id='${echoId}']`);
    if (newItem) newItem.classList.add('highlighted');
    const newMarker = echoMarkersMap.get(echoId);
    if (newMarker) {
        const newEcho = currentEchoesInView.find(e => e.id === echoId);
        if (newEcho) {
            const ageMs = new Date() - new Date(newEcho.last_played_at);
            let healthPercent = Math.max(0, 100 * (1 - (ageMs / ECHO_LIFESPAN_MS)));
            newMarker.setIcon(createHealthIcon(healthPercent, true));
            newMarker.setZIndexOffset(1000);
        }
    }
    highlightedEchoId = echoId;
}

function clearNearbyListAndMarkers() { currentEchoesInView = []; markers.clearLayers(); echoMarkersMap.clear(); renderNearbyList([]); }

window.keepEchoAlive = async (id) => {
    try {
        fetch(`${API_URL}/api/echoes/${id}/play`, {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            credentials: 'include',
        });

        // Update the UI immediately (turn the ring red/orange)
        const marker = echoMarkersMap.get(id); 
        if (marker) { 
            const echoData = currentEchoesInView.find(e => e.id === id); 
            if (echoData) echoData.last_played_at = new Date().toISOString(); 
            marker.setIcon(createHealthIcon(100, id === highlightedEchoId)); 
        } 
    } catch (err) { 
        console.error("Failed to send keep-alive ping:", err); 
    } 
};

// client/app.js - Faster Location Logic

// Global variable to track last fetch position to throttle API calls
let lastFetchPosition = null;

function onLocationUpdate(position) {
    // 1. Always update global state immediately
    currentUserPosition = { 
        lat: position.coords.latitude, 
        lng: position.coords.longitude 
    }; 
    const latLng = [currentUserPosition.lat, currentUserPosition.lng]; 

    // 2. VISUAL UPDATE: Move the blue dot immediately (High FPS)
    if (userMarker) {
        userMarker.setLatLng(latLng); 
    } else {
        userMarker = L.marker(latLng, { 
            icon: userLocationIcon, 
            interactive: false, 
            zIndexOffset: 1000 
        }).addTo(map); 
    }

    // 3. Update State variables
    const latStr = currentUserPosition.lat.toFixed(4);
    const lngStr = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latStr}_${lngStr}`;
    isUserInVicinity = true;
    updateActionButtonState();

    // 4. DATA FETCH (Throttled logic)
    // Only fetch new echoes if we have moved > 50 meters from the last fetch
    if (!lastFetchPosition) {
        lastFetchPosition = currentUserPosition;
        // First run: wait a moment for map bounds to settle then fetch
        setTimeout(() => fetchEchoesForCurrentView(), 500); 
    } else {
        // Calculate distance in meters
        const dist = map.distance(
            [lastFetchPosition.lat, lastFetchPosition.lng],
            latLng
        );
        
        // Threshold: 50 meters
        if (dist > 20) {
            console.log(`User moved ${Math.round(dist)}m. Refreshing echoes...`);
            lastFetchPosition = currentUserPosition;
            fetchEchoesForCurrentView();
        }
    }
}

function startLocationWatcher() { 
    if (locationWatcherId) navigator.geolocation.clearWatch(locationWatcherId); 
    
    if ("geolocation" in navigator) { 
        // OPTIMIZATION: Tighter settings for "Real Time" feel
        const options = { 
            enableHighAccuracy: true, 
            timeout: 10000,   // Fail if no signal within 10s
            maximumAge: 2000  // Force fresh GPS (don't use cache older than 2s)
        }; 
        locationWatcherId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, options); 
    } 
}

function onLocationError(error) { updateStatus(`Error: ${error.message}`, "error"); isUserInVicinity = false; updateActionButtonState(); }
function handleFindMeClick() { updateStatus("Locating...", "info"); if (!("geolocation" in navigator)) return updateStatus("Geolocation not supported.", "error"); const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }; navigator.geolocation.getCurrentPosition(position => { onLocationUpdate(position); map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16); startLocationWatcher(); }, onLocationError, options); }
function handleRecordClick() { if (!('geolocation' in navigator)) return updateStatus("Geolocation not supported.", "error"); const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }; navigator.geolocation.getCurrentPosition( position => { onLocationUpdate(position); map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16); startRecordingProcess(); }, err => { onLocationError(err); updateStatus("Could not get location.", "error"); }, options ); }

async function startRecordingProcess() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = uploadAndSaveEcho;
        mediaRecorder.start();
        stopPromptCycling();
        updateStatus(recordingMessages[Math.floor(Math.random() * recordingMessages.length)], 'success', 7000);
        let recordingPromptInterval = setInterval(() => {
            const randomIndex = Math.floor(Math.random() * recordingMessages.length);
            updateStatus(recordingMessages[randomIndex], 'success', 7000); 
        }, 8000);
        mediaRecorder.recordingPromptInterval = recordingPromptInterval;
        recordingTimer = {
            startTime: Date.now(),
            targetTime: Date.now() + MAX_RECORDING_SECONDS * 1000,
            intervalId: setInterval(() => {
                updateActionButtonState();
                if (Date.now() >= recordingTimer.targetTime) {
                    mediaRecorder.stop();
                }
            }, 1000)
        };
        updateActionButtonState();
    } catch (e) {
        console.error("Mic error:", e);
        updateStatus("Could not access mic.", "error");
    }
}

// client/app.js - New helper function

function triggerRippleAnimation(lat, lng) {
    if (!map) return;
    
    // Create a temporary Leaflet marker
    const rippleIcon = L.divIcon({
        className: 'ripple-marker',
        html: '<div class="ripple-ring"></div>',
        iconSize: [300, 300], // Matches the max size in CSS
        iconAnchor: [150, 150]
    });

    const rippleMarker = L.marker([lat, lng], { 
        icon: rippleIcon, 
        zIndexOffset: -1000 // Behind other markers
    }).addTo(map);

    // Remove it after animation completes (2 seconds)
    setTimeout(() => {
        map.removeLayer(rippleMarker);
    }, 2000);
}

function blobToBase64(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); }); }

// client/app.js - New Helper Function

function getBlobDuration(blob) {
    return new Promise((resolve) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
            if (audio.duration === Infinity) {
                // Fix for Chrome bug with webm duration
                audio.currentTime = 1e101;
                audio.ontimeupdate = () => {
                    this.ontimeupdate = () => {};
                    resolve(Math.round(audio.duration));
                }
            } else {
                resolve(Math.round(audio.duration));
            }
        };
        audio.src = URL.createObjectURL(blob);
    });
}

// client/app.js

async function uploadAndSaveEcho() {
    // 1. Calculate duration immediately (The "Wall Clock" Method)
    const endTime = Date.now();
    let calculatedDuration = 0;
    
    if (recordingTimer && recordingTimer.startTime) {
        calculatedDuration = Math.round((endTime - recordingTimer.startTime) / 1000);
    }
    // Ensure it's at least 1 second
    if (calculatedDuration < 1) calculatedDuration = 1;

    // 2. Cleanup timers
    if (mediaRecorder && mediaRecorder.recordingPromptInterval) {
        clearInterval(mediaRecorder.recordingPromptInterval);
    }
    if (recordingTimer) {
        clearInterval(recordingTimer.intervalId);
    }

    const collectedChunks = [...audioChunks];
    mediaRecorder = null;
    audioChunks = [];
    updateActionButtonState();
    
    // 3. Validation
    if (collectedChunks.length === 0) {
        updateStatus("Recording too short.", "error");
        return;
    }

    updateStatus("Processing...", "info", 0);

    // 4. Prepare Blob
    const audioBlob = new Blob(collectedChunks, { type: "audio/webm" });
    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;

    try {
        updateStatus("Preparing upload...", "info", 0);
        
        // 5. Get Presigned URL
        const presignedResponse = await fetch(`${API_URL}/presigned-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'include',
            body: JSON.stringify({ fileName: fileName, fileType: audioBlob.type })
        });

        if (!presignedResponse.ok) throw new Error(`Presigned URL failed: ${await presignedResponse.text()}`);
        const { url: uploadUrl, key: safeKey } = await presignedResponse.json();

        // 6. Upload to R2
        updateStatus("Uploading...", "info", 0);
        await fetch(uploadUrl, { method: "PUT", body: audioBlob, headers: { "Content-Type": audioBlob.type } });
        const audioUrl = `${R2_PUBLIC_URL_BASE}/${safeKey}`;

        // 7. Save Metadata to DB
        updateStatus("Saving...", "info", 0);
        
        const saveResponse = await fetch(`${API_URL}/echoes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'include',
            body: JSON.stringify({
                w3w_address: currentBucketKey, 
                audio_url: audioUrl, 
                lat: currentUserPosition.lat, 
                lng: currentUserPosition.lng, 
                duration: calculatedDuration // <--- Using the math result
            })
        });

        if (!saveResponse.ok) throw new Error(`Save metadata failed: ${await saveResponse.text()}`);
        
        updateStatus("Echo saved successfully!", "success");

        // NEW: Trigger the visual ripple
        triggerRippleAnimation(currentUserPosition.lat, currentUserPosition.lng);

        fetchEchoesForCurrentView();

    } catch (err) {
        console.error("Full echo process failed:", err);
        updateStatus(`Error: ${err.message}`, "error");
    }
}

async function checkLoginState() {
    try {
        const res = await fetch(`${API_URL}/api/users/me`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            loggedInUser = data.username;
            updateUIAfterLogin();
        } else {
            updateUIAfterLogout();
        }
    } catch {
        updateUIAfterLogout();
    }
}
async function handleLogout() {
    try { await fetch(`${API_URL}/api/users/logout`, { method: 'POST', credentials: 'include' }); } catch { /* ignore */ }
    loggedInUser = null;
    if (userMenuDropdown) userMenuDropdown.style.display = 'none';
    updateUIAfterLogout();
    if (locationWatcherId) { navigator.geolocation.clearWatch(locationWatcherId); locationWatcherId = null; }
    isUserInVicinity = false;
    updateActionButtonState();
}
function updateUIAfterLogin() {
    loggedOutView.style.display = "none";
    loggedInView.style.display = "block";
    welcomeMessage.textContent = loggedInUser;
    if (userAvatar) userAvatar.textContent = loggedInUser.charAt(0).toUpperCase();
    showToast(`Welcome, ${loggedInUser}.`, 'success');
    updateActionButtonState();
}
function updateUIAfterLogout() {
    loggedInView.style.display = 'none';
    loggedOutView.style.display = 'block';
    // Use the new updateStatus function to set the default logged-out message
    updateStatus("Click the compass to explore your area.", '', 0);
    updateActionButtonState();
}
function openModal(mode) {
    modalError.textContent = "";
    authForm.reset();
    if (mode === 'login') {
        modalTitle.textContent = "Sign in";
        modalSubmitBtn.textContent = "Sign in";
        authForm.dataset.mode = "login";
        document.getElementById('modal-switch').innerHTML = `No account? <a href="#" id="modal-switch-link">Register</a>`;
    } else {
        modalTitle.textContent = "Create account";
        modalSubmitBtn.textContent = "Register";
        authForm.dataset.mode = "register";
        document.getElementById('modal-switch').innerHTML = `Have an account? <a href="#" id="modal-switch-link">Sign in</a>`;
    }
    document.getElementById('modal-switch-link').addEventListener('click', (e) => {
        e.preventDefault();
        openModal(authForm.dataset.mode === 'login' ? 'register' : 'login');
    });
    authModal.style.display = "flex";
}
async function handleAuthFormSubmit(e) {
    e.preventDefault();
    modalError.textContent = "";
    const username = usernameInput.value;
    const password = passwordInput.value;
    const mode = authForm.dataset.mode;
    const endpoint = mode === 'login' ? "/api/users/login" : "/api/users/register";
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "An unknown error occurred.");
        if (mode === 'register') {
            modalError.textContent = "Registration successful! Please log in.";
            authForm.reset();
            openModal('login');
        } else {
            loggedInUser = data.user.username;
            updateUIAfterLogin();
            authModal.style.display = "none";
        }
    } catch (err) {
        modalError.textContent = err.message;
    }
}