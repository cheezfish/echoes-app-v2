// client/app.js - YOUR LATEST CODE + DYNAMIC PROMPTS FEATURE

const API_URL = 'https://echoes-server.cheezfish.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';
const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);

// --- CONFIG & ICONS ---
const MAX_RECORDING_SECONDS = 180;
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
let pendingRecording = null;
let loggedInUser = null, currentUserPosition = null, currentBucketKey = "";
let echoMarkersMap = new Map();
let clusterMarkersLayer = null;
let pendingReplyToEchoId = null;
let currentEchoesInView = [];
let highlightedEchoId = null;
let locationWatcherId = null;
let fetchTimeout = null;
let walksLoaded = false;
const deepLinkedEchoId = new URLSearchParams(window.location.search).get('echo');
let recordingTimer;
let activeWalk = null;
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
let loginBtn, welcomeMessage, loggedOutView, loggedInView, userPillBtn, userAvatar, userMenuDropdown, toastContainer, contextActionBtn, nearbyEchoesList, bottomSheet, sheetSummary;

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
        const dateStr = new Date(echo.created_at).toLocaleDateString();
        if (echo.username && echo.user_id) {
            const authorLink = document.createElement('a');
            authorLink.href = `profile.html?id=${echo.user_id}`;
            authorLink.className = 'echo-author-link';
            authorLink.textContent = echo.username;
            p.append(`Recorded on: ${dateStr} by `);
            p.appendChild(authorLink);
        } else {
            p.textContent = `Recorded on: ${dateStr} by an anonymous user`;
        }
        wrap.appendChild(h3);
        wrap.appendChild(p);
        let _playLogId = null;
        wrap.appendChild(buildAudioPlayer(
            echo.audio_url,
            async () => { _playLogId = await window.keepEchoAlive(echo.id); },
            (pct) => logPlayComplete(echo.id, _playLogId, pct)
        ));
        if (echo.transcript && echo.transcript_status === 'done') {
            const details = document.createElement('details');
            details.className = 'echo-transcript';
            const summary = document.createElement('summary');
            summary.textContent = 'Transcript';
            const tp = document.createElement('p');
            tp.textContent = echo.transcript;
            details.appendChild(summary);
            details.appendChild(tp);
            wrap.appendChild(details);
        }

        // Reply thread — async loaded
        const threadDiv = document.createElement('div');
        threadDiv.className = 'echo-thread';
        wrap.appendChild(threadDiv);
        fetch(`${API_URL}/echoes/${echo.id}/replies`)
            .then(r => r.json())
            .then(replies => {
                if (replies.length > 0) {
                    const label = document.createElement('p');
                    label.className = 'thread-label';
                    label.textContent = `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`;
                    threadDiv.appendChild(label);
                    replies.forEach(reply => {
                        const row = document.createElement('div');
                        row.className = 'thread-reply-row';
                        const meta = document.createElement('span');
                        meta.className = 'thread-reply-meta';
                        meta.textContent = `${reply.username || 'anon'} · ${new Date(reply.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                        row.appendChild(meta);
                        row.appendChild(buildAudioPlayer(reply.audio_url, null));
                        threadDiv.appendChild(row);
                    });
                }
                if (loggedInUser) {
                    const replyBtn = document.createElement('button');
                    replyBtn.className = 'reply-btn';
                    replyBtn.textContent = '+ Reply';
                    replyBtn.addEventListener('click', () => {
                        pendingReplyToEchoId = echo.id;
                        map.closePopup();
                        handleRecordClick();
                    });
                    threadDiv.appendChild(replyBtn);
                }
            })
            .catch(() => {});

        const shareBtn = document.createElement('button');
        shareBtn.className = 'share-echo-btn';
        shareBtn.textContent = 'Share';
        shareBtn.addEventListener('click', () => {
            const url = `${location.origin}/?echo=${echo.id}`;
            if (navigator.share) {
                navigator.share({ title: echo.location_name || 'An Echo', url });
            } else {
                navigator.clipboard.writeText(url).then(() => showToast('Link copied', 'success'));
            }
        });
        wrap.appendChild(shareBtn);

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
    // Restore walk in progress, or start a pending one from My Echoes
    const pendingWalkId = localStorage.getItem('echoes_pending_walk');
    if (pendingWalkId) {
        localStorage.removeItem('echoes_pending_walk');
        setTimeout(() => startWalk(pendingWalkId), 1000);
    } else {
        _restoreActiveWalk();
    }

    // Auth state comes from auth.js via Clerk — update UI when ready
    window.addEventListener('auth:ready', (e) => {
        const user = e.detail?.user;
        if (user) {
            loggedInUser = user.username;
            updateUIAfterLogin();
        } else {
            updateUIAfterLogout();
        }
    });
    const savedMapState = JSON.parse(localStorage.getItem('echoes_map') || 'null');
    const initCenter = savedMapState ? [savedMapState.lat, savedMapState.lng] : [20, 0];
    const initZoom  = savedMapState ? savedMapState.zoom : 2;
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false,
        zoomSnap: 0,
        zoomDelta: 0.25,
        bounceAtZoomLimits: false,
        scrollWheelZoom: true,
    }).setView(initCenter, initZoom);
    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.webp?key=oeJYklnaUPpZgpHgTszf', {
        maxZoom: 20,
        keepBuffer: 4,
        updateWhenZooming: false,
        attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    L.control.attribution({ position: 'topright' }).addTo(map);
    markers = L.markerClusterGroup({ disableClusteringAtZoom: 15, animate: false });
    map.addLayer(markers);
    map.on('movestart', () => { isUserInVicinity = false; updateActionButtonState(); });

    function refreshMapView() {
        const zoom = map.getZoom();
        if (zoom > 12) {
            clearClusterMarkers();
            fetchEchoesForCurrentView();
        } else {
            // Show clusters at all zoom levels below 13
            // precision 2 = continent, 3 = country, 5 = city
            let precision;
            if (zoom < 4) precision = 2;
            else if (zoom < 9) precision = 3;
            else precision = 5;
            clearNearbyListAndMarkers();
            fetchAndRenderClusters(precision);
        }
    }

    map.on('moveend', () => {
        const c = map.getCenter();
        localStorage.setItem('echoes_map', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(refreshMapView, 500);
    });

    // Load on initial view (map starts at zoom 2 — show clusters once tiles settle)
    map.once('load', refreshMapView);
    setTimeout(refreshMapView, 1000);

    // Handle deep-linked echo (?echo=id) after initial markers load
    if (deepLinkedEchoId) setTimeout(handleDeepLinkedEcho, 1500);
}

function setupEventListeners() {
    loginBtn.addEventListener('click', () => window.signIn());
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
    document.getElementById('preview-post-btn').addEventListener('click', confirmPostEcho);
    document.getElementById('preview-discard-btn').addEventListener('click', dismissPreview);
    document.getElementById('walk-banner-next').addEventListener('click', advanceWalk);
    document.getElementById('walk-banner-end').addEventListener('click', endWalk);

    document.querySelectorAll('.sheet-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sheet-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const isWalks = btn.dataset.tab === 'walks';
            document.getElementById('nearby-echoes-list').style.display = isWalks ? 'none' : '';
            document.getElementById('walks-browse-list').style.display = isWalks ? '' : 'none';
            if (isWalks && !walksLoaded) loadPublicWalks();
        });
    });
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
        const elapsed = Math.round((Date.now() - recordingTimer.startTime) / 1000);
        const secondsLeft = Math.max(0, Math.round((recordingTimer.targetTime - Date.now()) / 1000));
        const mm = Math.floor(elapsed / 60);
        const ss = String(elapsed % 60).padStart(2, '0');
        const isWarning = secondsLeft <= 30;
        contextActionBtn.className = isWarning ? 'is-recording is-recording-warning' : 'is-recording';
        contextActionBtn.innerHTML = `<span>Stop (${mm}:${ss})</span>`;
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

        const response = await fetch(url);
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

function clearClusterMarkers() {
    if (clusterMarkersLayer) {
        map.removeLayer(clusterMarkersLayer);
        clusterMarkersLayer = null;
    }
}

async function fetchAndRenderClusters(precision) {
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    try {
        const url = new URL(`${API_URL}/echoes/clusters`);
        url.searchParams.append('sw_lng', sw.lng);
        url.searchParams.append('sw_lat', sw.lat);
        url.searchParams.append('ne_lng', ne.lng);
        url.searchParams.append('ne_lat', ne.lat);
        url.searchParams.append('precision', precision);
        const res = await fetch(url);
        if (!res.ok) return;
        const clusters = await res.json();
        clearClusterMarkers();
        if (clusters.length === 0) {
            updateStatus("No echoes in this region yet.", "info", 0);
            return;
        }
        clusterMarkersLayer = L.layerGroup();
        clusters.forEach(c => {
            const radius = Math.min(8 + Math.sqrt(c.count) * 4, 40);
            L.circleMarker([c.center_lat, c.center_lng], {
                radius,
                color: '#007bff',
                fillColor: '#007bff',
                fillOpacity: 0.25,
                weight: 2,
                opacity: 0.7,
            }).bindTooltip(`${c.count} echo${c.count !== 1 ? 's' : ''}`, { permanent: false, direction: 'top' })
              .addTo(clusterMarkersLayer);
        });
        clusterMarkersLayer.addTo(map);
        const total = clusters.reduce((s, c) => s + c.count, 0);
        updateStatus(`${total} echo${total !== 1 ? 's' : ''} across ${clusters.length} area${clusters.length !== 1 ? 's' : ''}. Zoom in to explore.`, "info", 0);
    } catch (err) {
        console.error('[Clusters] fetch error:', err);
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

    if (nearby.length === 0 && sorted.length > 0 && currentUserPosition) {
        const closest = sorted[0];
        const dist = closest.distance_meters < 1000
            ? `${Math.round(closest.distance_meters)}m`
            : `${(closest.distance_meters / 1000).toFixed(1)}km`;
        const hint = document.createElement('p');
        hint.className = 'empty-message';
        hint.textContent = `Nearest echo is ${dist} away — walk closer to listen.`;
        nearbyEchoesList.appendChild(hint);
    }

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
            item.appendChild(buildAudioPlayer(echo.audio_url, () => window.keepEchoAlive(echo.id)));
        }

        // Report button — only visible on hover via CSS
        const reportBtn = document.createElement('button');
        reportBtn.className = 'echo-report-btn';
        reportBtn.title = 'Report this echo';
        reportBtn.innerHTML = `<img src="https://api.iconify.design/material-symbols:flag-outline.svg?color=%23888" alt="Report" width="14" height="14">`;
        reportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleReportEcho(echo.id);
        });
        item.appendChild(reportBtn);

        item.addEventListener('click', (e) => {
            if (!e.target.closest('audio') && !e.target.closest('.echo-report-btn')) handleListItemClick(echo.id);
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

async function handleReportEcho(echoId) {
    const reason = prompt('Why are you reporting this echo?\n(e.g. offensive content, spam, inappropriate)');
    if (!reason || !reason.trim()) return;
    try {
        const res = await window.authFetch(`${API_URL}/api/echoes/${echoId}/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason.trim() })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Report failed.');
        }
        showToast('Report submitted. Thank you.', 'success');
    } catch (err) {
        showToast(`Could not submit report: ${err.message}`, 'error');
    }
}

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
        const res = await fetch(`${API_URL}/api/echoes/${id}/play`, {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                lat: currentUserPosition?.lat ?? null,
                lng: currentUserPosition?.lng ?? null,
                session_id: sessionId
            })
        });
        const data = res.ok ? await res.json() : {};

        const marker = echoMarkersMap.get(id);
        if (marker) {
            const echoData = currentEchoesInView.find(e => e.id === id);
            if (echoData) echoData.last_played_at = new Date().toISOString();
            marker.setIcon(createHealthIcon(100, id === highlightedEchoId));
        }
        return data.play_log_id ?? null;
    } catch (err) {
        console.error("Failed to send keep-alive ping:", err);
        return null;
    }
};

function logPlayComplete(echoId, playLogId, percentPlayed) {
    if (!playLogId) return;
    fetch(`${API_URL}/api/echoes/${echoId}/play-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ play_log_id: playLogId, percent_played: percentPlayed })
    }).catch(() => {});
}

// ── WALK GUIDANCE ─────────────────────────────────────────────────────────────

function _bearingArrow(deg) {
    const dirs = ['↑','↗','→','↘','↓','↙','←','↖'];
    return dirs[Math.round(deg / 45) % 8];
}

function _bearingDeg(lat1, lng1, lat2, lng2) {
    const toR = d => d * Math.PI / 180;
    const dL = toR(lng2 - lng1);
    const y = Math.sin(dL) * Math.cos(toR(lat2));
    const x = Math.cos(toR(lat1)) * Math.sin(toR(lat2)) - Math.sin(toR(lat1)) * Math.cos(toR(lat2)) * Math.cos(dL);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function _distM(lat1, lng1, lat2, lng2) {
    return map.distance([lat1, lng1], [lat2, lng2]);
}

async function startWalk(walkId) {
    try {
        const res = await fetch(`${API_URL}/api/walks/${walkId}`);
        if (!res.ok) throw new Error('Could not load walk');
        const data = await res.json();
        if (!data.echoes?.length) { showToast('This walk has no echoes yet.', 'error'); return; }
        activeWalk = { id: walkId, title: data.title, echoes: data.echoes, currentIndex: 0 };
        localStorage.setItem('echoes_active_walk', JSON.stringify(activeWalk));
        updateWalkBanner();
        showToast(`Walk started: ${data.title}`, 'success');
        const first = activeWalk.echoes[0];
        map.flyTo([first.lat, first.lng], Math.max(map.getZoom(), 15));
    } catch (err) {
        showToast('Could not start walk.', 'error');
    }
}

function endWalk() {
    activeWalk = null;
    localStorage.removeItem('echoes_active_walk');
    updateWalkBanner();
}

// ── ONBOARDING OVERLAY ────────────────────────────────────────────────────────

function showOnboardingIfNeeded() {
    if (localStorage.getItem('echoes_welcomed')) return;
    const overlay = document.createElement('div');
    overlay.id = 'onboarding-overlay';
    overlay.innerHTML = `
        <div id="onboarding-card">
            <div id="onboarding-icon">◎</div>
            <h2>How Echoes works</h2>
            <p>People leave short audio recordings at real places. Walk within <strong>100 metres</strong> of a marker to unlock and hear it.</p>
            <p class="onboarding-sub">Tap the map to explore. The closer you get, the more you hear.</p>
            <button id="onboarding-dismiss" class="pill-btn">Got it</button>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('onboarding-dismiss').addEventListener('click', () => {
        overlay.classList.add('fade-out');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        localStorage.setItem('echoes_welcomed', '1');
    });
}

// ── WALK DISCOVERY ────────────────────────────────────────────────────────────

async function loadPublicWalks() {
    const list = document.getElementById('walks-browse-list');
    list.innerHTML = '<p class="empty-message">Loading walks…</p>';
    try {
        const res = await fetch(`${API_URL}/api/walks/public`);
        const walks = await res.json();
        walksLoaded = true;
        list.innerHTML = '';
        if (!walks.length) {
            list.innerHTML = '<p class="empty-message">No walks yet — be the first to create one.</p>';
            return;
        }
        walks.forEach(w => list.appendChild(buildWalkBrowseCard(w)));
    } catch (_) {
        list.innerHTML = '<p class="empty-message">Could not load walks.</p>';
    }
}

function buildWalkBrowseCard(walk) {
    const card = document.createElement('div');
    card.className = 'walk-browse-card';
    const info = document.createElement('div');
    info.className = 'walk-browse-info';
    const title = document.createElement('div');
    title.className = 'walk-browse-title';
    title.textContent = walk.title;
    const meta = document.createElement('div');
    meta.className = 'walk-browse-meta';
    meta.textContent = `${walk.echo_count} echo${walk.echo_count !== 1 ? 's' : ''} · by ${walk.username}`;
    info.appendChild(title);
    info.appendChild(meta);
    const startBtn = document.createElement('button');
    startBtn.className = 'pill-btn walk-browse-start';
    startBtn.textContent = 'Start Walk';
    startBtn.addEventListener('click', () => startWalk(walk.id));
    card.appendChild(info);
    card.appendChild(startBtn);
    return card;
}

// ── ECHO DEEP-LINK ────────────────────────────────────────────────────────────

async function handleDeepLinkedEcho() {
    if (!deepLinkedEchoId) return;
    try {
        const res = await fetch(`${API_URL}/echoes/${deepLinkedEchoId}`);
        if (!res.ok) return;
        const echo = await res.json();
        map.flyTo([echo.lat, echo.lng], 17, { duration: 1.2 });
        map.once('moveend', () => {
            const marker = echoMarkersMap.get(Number(deepLinkedEchoId));
            if (marker) {
                marker.openPopup();
            } else {
                // Marker may not be in view yet — refresh then open
                fetchEchoesForCurrentView();
                setTimeout(() => {
                    const m = echoMarkersMap.get(Number(deepLinkedEchoId));
                    if (m) m.openPopup();
                }, 1200);
            }
        });
    } catch (_) {}
}

function advanceWalk() {
    if (!activeWalk) return;
    activeWalk.currentIndex++;
    if (activeWalk.currentIndex >= activeWalk.echoes.length) {
        showToast('Walk complete!', 'success');
        endWalk();
        return;
    }
    localStorage.setItem('echoes_active_walk', JSON.stringify(activeWalk));
    const next = activeWalk.echoes[activeWalk.currentIndex];
    map.flyTo([next.lat, next.lng], Math.max(map.getZoom(), 15));
    updateWalkBanner();
}

function updateWalkBanner() {
    const banner = document.getElementById('walk-banner');
    if (!banner) return;
    if (!activeWalk) { banner.style.display = 'none'; return; }

    const target = activeWalk.echoes[activeWalk.currentIndex];
    const total  = activeWalk.echoes.length;
    const idx    = activeWalk.currentIndex;
    const nextBtn = document.getElementById('walk-banner-next');

    let distText = '—', arrowChar = '·', arrived = false;
    if (currentUserPosition && target.lat && target.lng) {
        const dist = _distM(currentUserPosition.lat, currentUserPosition.lng, target.lat, target.lng);
        distText = dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`;
        arrowChar = _bearingArrow(_bearingDeg(currentUserPosition.lat, currentUserPosition.lng, target.lat, target.lng));
        arrived = dist <= 100;
    }

    document.getElementById('walk-banner-arrow').textContent    = arrived ? '📍' : arrowChar;
    document.getElementById('walk-banner-dist').textContent     = arrived ? "You're here" : distText;
    document.getElementById('walk-banner-location').textContent = target.location_name || 'Echo';
    document.getElementById('walk-banner-step').textContent     = `${idx + 1}/${total}`;
    nextBtn.style.display = arrived ? '' : 'none';
    banner.style.display = 'flex';
}

function _restoreActiveWalk() {
    try {
        const stored = localStorage.getItem('echoes_active_walk');
        if (stored) activeWalk = JSON.parse(stored);
    } catch { localStorage.removeItem('echoes_active_walk'); }
}

// ── END WALK GUIDANCE ─────────────────────────────────────────────────────────

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
    if (!isUserInVicinity) {
        navigator.vibrate?.(200);
        showOnboardingIfNeeded();
    }
    isUserInVicinity = true;
    updateActionButtonState();
    updateWalkBanner();

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
        mediaRecorder.onstop = showRecordingPreview;
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

function showRecordingPreview() {
    const duration = recordingTimer?.startTime
        ? Math.max(1, Math.round((Date.now() - recordingTimer.startTime) / 1000))
        : 1;

    if (mediaRecorder?.recordingPromptInterval) clearInterval(mediaRecorder.recordingPromptInterval);
    if (recordingTimer) { clearInterval(recordingTimer.intervalId); recordingTimer = null; }

    const chunks = [...audioChunks];
    mediaRecorder = null;
    audioChunks = [];

    if (chunks.length === 0) {
        updateStatus("Recording too short.", "error");
        updateActionButtonState();
        return;
    }

    const blob = new Blob(chunks, { type: 'audio/webm' });
    const blobUrl = URL.createObjectURL(blob);
    pendingRecording = { blob, blobUrl, duration };

    const panel = document.getElementById('recording-preview');
    const heading = panel.querySelector('h4');
    if (heading) heading.textContent = pendingReplyToEchoId ? 'Reply to echo' : 'Review your echo';
    const playerWrap = document.getElementById('preview-player-wrap');
    playerWrap.innerHTML = '';
    playerWrap.appendChild(buildAudioPlayer(blobUrl, null));
    panel.classList.add('visible');
    updateActionButtonState();
}

function dismissPreview(isPosting = false) {
    if (pendingRecording && !isPosting) {
        fetch(`${API_URL}/api/echoes/discard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                duration_seconds: pendingRecording.duration ?? null,
                lat: currentUserPosition?.lat ?? null,
                lng: currentUserPosition?.lng ?? null
            })
        }).catch(() => {});
    }
    if (pendingRecording?.blobUrl) URL.revokeObjectURL(pendingRecording.blobUrl);
    pendingRecording = null;
    pendingReplyToEchoId = null;
    document.getElementById('recording-preview').classList.remove('visible');
    updateActionButtonState();
}

async function confirmPostEcho() {
    if (!pendingRecording) return;
    const { blob, duration } = pendingRecording;
    const postBtn = document.getElementById('preview-post-btn');
    postBtn.disabled = true;
    postBtn.textContent = 'Posting…';
    dismissPreview(true);

    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;
    try {
        updateStatus("Preparing upload...", "info", 0);
        const presignedResponse = await window.authFetch(`${API_URL}/presigned-url`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName, fileType: blob.type })
        });
        if (!presignedResponse.ok) throw new Error('Presigned URL failed');
        const { url: uploadUrl, key: safeKey } = await presignedResponse.json();

        updateStatus("Uploading...", "info", 0);
        await fetch(uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
        const audioUrl = `${R2_PUBLIC_URL_BASE}/${safeKey}`;

        updateStatus("Saving...", "info", 0);
        const replyToId = pendingReplyToEchoId;
        pendingReplyToEchoId = null;
        const saveResponse = await window.authFetch(`${API_URL}/echoes`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                w3w_address: currentBucketKey,
                audio_url: audioUrl,
                lat: currentUserPosition.lat,
                lng: currentUserPosition.lng,
                duration,
                ...(replyToId ? { parent_id: replyToId } : {})
            })
        });
        if (!saveResponse.ok) throw new Error('Save failed');

        updateStatus(replyToId ? "Reply posted!" : "Echo saved!", "success");
        triggerRippleAnimation(currentUserPosition.lat, currentUserPosition.lng);
        if (!replyToId) fetchEchoesForCurrentView();
    } catch (err) {
        console.error("Echo upload failed:", err);
        updateStatus(`Error: ${err.message}`, "error");
    } finally {
        postBtn.disabled = false;
        postBtn.textContent = 'Post Echo';
    }
}

async function uploadAndSaveEcho() {
    showRecordingPreview();
}

async function handleLogout() {
    loggedInUser = null;
    if (userMenuDropdown) userMenuDropdown.style.display = 'none';
    if (locationWatcherId) { navigator.geolocation.clearWatch(locationWatcherId); locationWatcherId = null; }
    isUserInVicinity = false;
    updateActionButtonState();
    await window.signOut();
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
    updateStatus("Click the compass to explore your area.", '', 0);
    updateActionButtonState();
}