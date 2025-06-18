// client/app.js - YOUR LATEST CODE + DYNAMIC PROMPTS FEATURE

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

// --- CONFIG & ICONS ---
const MAX_RECORDING_SECONDS = 60;
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
let userToken = null, loggedInUser = null, currentUserPosition = null, currentBucketKey = "";
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
    "They're listening...",
    "Your voice, traveling.",
    "Someone will find this.",
    "A perfect transmission.",
    "Sending it out into the world.",
    "Message received.",

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
    "History is being recorded."
];

// --- UI ELEMENT CACHE ---
let loginBtn, registerBtn, welcomeMessage, loggedOutView, loggedInView, userMenuButton, userMenuDropdown, globalStatusBar, contextActionBtn, nearbyEchoesList, authModal, authForm, modalError, usernameInput, passwordInput, modalTitle, modalSubmitBtn;

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
    registerBtn = document.getElementById("register-btn");
    welcomeMessage = document.getElementById("welcome-message");
    loggedOutView = document.getElementById("logged-out-view");
    loggedInView = document.getElementById("logged-in-view");
    userMenuButton = document.getElementById("user-menu-button");
    userMenuDropdown = document.getElementById("user-menu-dropdown");
    globalStatusBar = document.getElementById("global-status-bar");
    contextActionBtn = document.getElementById("context-action-btn");
    nearbyEchoesList = document.getElementById("nearby-echoes-list");
    authModal = document.getElementById("auth-modal");
    authForm = document.getElementById("auth-form");
    modalError = document.getElementById("modal-error");
    usernameInput = document.getElementById("username");
    passwordInput = document.getElementById("password");
    modalTitle = document.getElementById("modal-title");
    modalSubmitBtn = document.getElementById("modal-submit-btn");
    initializeApp();
});

function initializeApp() {
    setupEventListeners();
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
    registerBtn.addEventListener('click', () => openModal('register'));
    contextActionBtn.addEventListener('click', handleContextActionClick);
    userMenuButton.addEventListener('click', toggleUserMenu);
    window.addEventListener('click', (e) => {
        if (userMenuDropdown && userMenuButton && !userMenuButton.contains(e.target) && !userMenuDropdown.contains(e.target)) {
            userMenuDropdown.style.display = 'none';
        }
    });
    userMenuDropdown.querySelector('#logout-btn').addEventListener('click', handleLogout);
    authModal.querySelector('.close-btn').addEventListener('click', () => authModal.style.display = 'none');
    authModal.addEventListener('click', e => { if (e.target === authModal) authModal.style.display = 'none'; });
    authForm.addEventListener('submit', handleAuthFormSubmit);
}

// --- CORE UI MANAGEMENT ---
function updateActionButtonState() {
    if (!contextActionBtn) return;
    contextActionBtn.classList.remove('is-recording');
    let isRecording = mediaRecorder && mediaRecorder.state === 'recording';
    
    // Stop prompts before determining the new state
    stopPromptCycling();

    if (isRecording) {
        contextActionBtn.className = 'record is-recording';
        let secondsLeft = Math.max(0, Math.round((recordingTimer.targetTime - Date.now()) / 1000));
        contextActionBtn.innerHTML = `<span>Stop (${secondsLeft}s)</span>`;
    } else if (isUserInVicinity && userToken) {
        contextActionBtn.className = 'record';
        contextActionBtn.title = 'Record an Echo';
        contextActionBtn.innerHTML = `<img src="https://api.iconify.design/material-symbols:mic.svg?color=white" alt="Record"> <span>Record</span>`;
        startPromptCycling(); // Start prompts only in this specific state
    } else {
        contextActionBtn.className = 'find-me';
        contextActionBtn.title = 'Find My Location';
        contextActionBtn.innerHTML = `<img src="https://api.iconify.design/material-symbols:my-location.svg?color=white" alt="Find Me">`;
        // Set a default message if not prompting
        if (loggedInUser) {
            updateStatus(`Welcome, ${loggedInUser}!`, 'info', 0);
        } else {
            updateStatus("Click the compass to explore your area.", 'info', 0);
        }
    }
}

function handleContextActionClick() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    } else if (isUserInVicinity && userToken) {
        handleRecordClick();
    } else {
        handleFindMeClick();
    }
}

function toggleUserMenu() { userMenuDropdown.style.display = userMenuDropdown.style.display === 'block' ? 'none' : 'block'; }

function updateStatus(message, type = 'info', duration = 4000) {
    if (!globalStatusBar) return;
    globalStatusBar.textContent = message;
    globalStatusBar.className = `global-status-bar ${type}`;
    if (duration > 0) {
        setTimeout(() => {
            if (globalStatusBar.textContent === message) {
                // When a temporary message expires, revert to the default state message
                updateActionButtonState(); 
            }
        }, duration);
    }
}

// --- NEW PROMPT CYCLING FUNCTIONS ---
function startPromptCycling() {
    if (promptInterval) return;
    let currentIndex = Math.floor(Math.random() * promptMessages.length);
    updateStatus(promptMessages[currentIndex], 'info', 0);
    promptInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % promptMessages.length;
        updateStatus(promptMessages[currentIndex], 'info', 0);
    }, 10000);
}

function stopPromptCycling() {
    clearInterval(promptInterval);
    promptInterval = null;
}

// --- INTERACTIVITY FUNCTIONS ---
async function fetchEchoesForCurrentView() {
    const center = map.getBounds().getCenter();
    updateStatus("Scanning for echoes...", "info");
    try {
        const response = await fetch(`${API_URL}/echoes?lat=${center.lat}&lng=${center.lng}`);
        if (!response.ok) throw new Error("Server could not fetch echoes.");
        currentEchoesInView = await response.json();
        renderMapMarkers(currentEchoesInView);
        renderNearbyList(currentEchoesInView);
        if (currentEchoesInView.length > 0) updateStatus(`${currentEchoesInView.length} echoes found in this area.`, "success");
        else updateStatus("No echoes found here. Be the first!", "info", 0);
    } catch (err) {
        updateStatus("Could not fetch echoes.", "error");
        console.error("Fetch Echoes Error:", err);
    }
}

function renderNearbyList(echoes) {
    nearbyEchoesList.innerHTML = '';
    if (echoes.length === 0) {
        nearbyEchoesList.innerHTML = `<p id="empty-message" style="text-align:center; padding: 2rem;">No echoes found in the current map view.</p>`;
        return;
    }
    echoes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    echoes.forEach(echo => {
        const item = document.createElement('div');
        item.className = 'my-echo-item';
        item.dataset.echoId = echo.id;
        const recordedDateTime = new Date(echo.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const locationDisplayName = echo.location_name || 'A Discovered Place';
        item.innerHTML = `<div class="info-row"><span class="location-name">${locationDisplayName}</span><span class="date-info">by ${echo.username || 'anonymous'}</span></div><audio controls preload="metadata" src="${echo.audio_url}" onplay="window.keepEchoAlive(${echo.id})"></audio><div class="actions-row"><span class="date-info">Recorded: ${recordedDateTime}</span></div>`;
        item.addEventListener('click', (e) => {
            if (e.target.tagName !== 'AUDIO' && !e.target.closest('audio')) handleListItemClick(echo.id);
        });
        nearbyEchoesList.appendChild(item);
    });
}

function renderMapMarkers(echoes) {
    markers.clearLayers();
    echoMarkersMap.clear();
    echoes.forEach(echo => {
        const ageMs = new Date() - new Date(echo.last_played_at);
        let healthPercent = Math.max(0, 100 * (1 - (ageMs / ECHO_LIFESPAN_MS)));
        const healthIcon = createHealthIcon(healthPercent, echo.id === highlightedEchoId);
        const marker = L.marker([echo.lat, echo.lng], { icon: healthIcon });
        marker.on('click', () => handleMarkerClick(echo.id));
        echoMarkersMap.set(echo.id, marker);
        markers.addLayer(marker);
    });
}

function handleListItemClick(echoId) { const marker = echoMarkersMap.get(echoId); if (marker) { map.flyTo(marker.getLatLng(), map.getZoom() < 16 ? 16 : map.getZoom()); highlightEcho(echoId); } }
function handleMarkerClick(echoId) { const listItem = nearbyEchoesList.querySelector(`.my-echo-item[data-echo-id='${echoId}']`); if (listItem) { listItem.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlightEcho(echoId); } }

function highlightEcho(echoId) {
    if (highlightedEchoId === echoId) return;
    if (highlightedEchoId) {
        const prevItem = nearbyEchoesList.querySelector(`.my-echo-item[data-echo-id='${highlightedEchoId}']`);
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
    const newItem = nearbyEchoesList.querySelector(`.my-echo-item[data-echo-id='${echoId}']`);
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

window.keepEchoAlive = async (id) => { try { fetch(`${API_URL}/api/echoes/${id}/play`, { method: "POST" }); const marker = echoMarkersMap.get(id); if (marker) { const echoData = currentEchoesInView.find(e => e.id === id); if (echoData) echoData.last_played_at = new Date().toISOString(); marker.setIcon(createHealthIcon(100, id === highlightedEchoId)); } } catch (err) { console.error("Failed to send keep-alive ping:", err); } };
function onLocationUpdate(position) { currentUserPosition = { lat: position.coords.latitude, lng: position.coords.longitude }; const latLng = [currentUserPosition.lat, currentUserPosition.lng]; if (userMarker) userMarker.setLatLng(latLng); else userMarker = L.marker(latLng, { icon: userLocationIcon, interactive: false, zIndexOffset: 1000 }).addTo(map); const latStr = currentUserPosition.lat.toFixed(4); const lngStr = currentUserPosition.lng.toFixed(4); currentBucketKey = `sq_${latStr}_${lngStr}`; isUserInVicinity = true; updateActionButtonState(); }
function onLocationError(error) { updateStatus(`Error: ${error.message}`, "error"); isUserInVicinity = false; updateActionButtonState(); }
function startLocationWatcher() { if (locationWatcherId) navigator.geolocation.clearWatch(locationWatcherId); if ("geolocation" in navigator) { const options = { enableHighAccuracy: true, timeout: 27000, maximumAge: 30000 }; locationWatcherId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, options); } }
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

function blobToBase64(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); }); }

async function uploadAndSaveEcho() {
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
    updateStatus("Processing...", "info", 0);
    if (collectedChunks.length === 0) {
        updateStatus("Recording too short.", "error");
        return;
    }
    const audioBlob = new Blob(collectedChunks, { type: "audio/webm" });
    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;
    try {
        updateStatus("Preparing upload...", "info", 0);
        const presignedResponse = await fetch(`${API_URL}/presigned-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: fileName, fileType: audioBlob.type }) });
        if (!presignedResponse.ok) throw new Error(`Presigned URL failed: ${await presignedResponse.text()}`);
        const { url: uploadUrl } = await presignedResponse.json();
        updateStatus("Uploading...", "info", 0);
        await fetch(uploadUrl, { method: "PUT", body: audioBlob, headers: { "Content-Type": audioBlob.type } });
        const audioUrl = `${R2_PUBLIC_URL_BASE}/${fileName}`;
        updateStatus("Saving...", "info", 0);
        const audioBase64 = await blobToBase64(audioBlob);
        const saveResponse = await fetch(`${API_URL}/echoes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
            body: JSON.stringify({ w3w_address: currentBucketKey, audio_url: audioUrl, lat: currentUserPosition.lat, lng: currentUserPosition.lng, audio_blob_base64: audioBase64 })
        });
        if (!saveResponse.ok) throw new Error(`Save metadata failed: ${await saveResponse.text()}`);
        updateStatus("Echo saved successfully!", "success");
        fetchEchoesForCurrentView();
    } catch (err) {
        console.error("Full echo process failed:", err);
        updateStatus(`Error: ${err.message}`, "error");
    }
}

function checkLoginState() { userToken = localStorage.getItem("echoes_token"); if (userToken) { try { const payload = JSON.parse(atob(userToken.split(".")[1])); loggedInUser = payload.user.username; updateUIAfterLogin(); } catch (err) { console.error("Failed to decode token", err); handleLogout(); } } else { updateUIAfterLogout(); } }
function handleLogout() { localStorage.removeItem("echoes_token"); userToken = null; loggedInUser = null; if (userMenuDropdown) userMenuDropdown.style.display = 'none'; updateUIAfterLogout(); if (locationWatcherId) { navigator.geolocation.clearWatch(locationWatcherId); locationWatcherId = null; } isUserInVicinity = false; updateActionButtonState(); }
function updateUIAfterLogin() { loggedOutView.style.display = "none"; loggedInView.style.display = "block"; welcomeMessage.textContent = loggedInUser; updateStatus(`Welcome, ${loggedInUser}!`, 'success', 0); updateActionButtonState(); }
function updateUIAfterLogout() { loggedInView.style.display = 'none'; loggedOutView.style.display = 'block'; updateStatus("Click the compass to explore your area.", 'info', 0); updateActionButtonState(); }
function openModal(mode) { modalError.textContent = ""; authForm.reset(); if (mode === 'login') { modalTitle.textContent = "Login"; modalSubmitBtn.textContent = "Login"; authForm.dataset.mode = "login"; } else { modalTitle.textContent = "Register"; modalSubmitBtn.textContent = "Register"; authForm.dataset.mode = "register"; } authModal.style.display = "flex"; }
async function handleAuthFormSubmit(e) { e.preventDefault(); modalError.textContent = ""; const username = usernameInput.value; const password = passwordInput.value; const mode = authForm.dataset.mode; const endpoint = mode === 'login' ? "/api/users/login" : "/api/users/register"; try { const response = await fetch(`${API_URL}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "An unknown error occurred."); if (mode === 'register') { modalError.textContent = "Registration successful! Please log in."; authForm.reset(); openModal('login'); } else { localStorage.setItem("echoes_token", data.token); checkLoginState(); authModal.style.display = "none"; } } catch (err) { modalError.textContent = err.message; } }