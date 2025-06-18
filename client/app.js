// client/app.js - FINAL CORRECTED VERSION

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

// --- UI ELEMENT CACHE ---
let recordBtn, loginBtn, registerBtn, logoutBtn, welcomeMessage, findMeBtn, statusMessageEl, nearbyEchoesList, authModal, myEchoesBtn, authForm, modalError, usernameInput, passwordInput, modalTitle, modalSubmitBtn;

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

/** Main initialization on page load */
document.addEventListener('DOMContentLoaded', () => {
    recordBtn = document.getElementById("record-btn");
    loginBtn = document.getElementById("login-btn");
    registerBtn = document.getElementById("register-btn");
    logoutBtn = document.getElementById("logout-btn");
    welcomeMessage = document.getElementById("welcome-message");
    findMeBtn = document.getElementById("find-me-btn");
    statusMessageEl = document.getElementById("status-message");
    nearbyEchoesList = document.getElementById("nearby-echoes-list");
    authModal = document.getElementById("auth-modal");
    myEchoesBtn = document.getElementById("my-echoes-btn");
    authForm = document.getElementById("auth-form");
    modalError = document.getElementById("modal-error");
    usernameInput = document.getElementById("username");
    passwordInput = document.getElementById("password");
    // Get modal title and submit button for the fixed openModal function
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
    map.on('moveend', () => {
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(() => {
            if (map.getZoom() > 12) {
                fetchEchoesForCurrentView();
            } else {
                clearNearbyListAndMarkers();
                updateStatus("Zoom in further to discover echoes.");
            }
        }, 500);
    });
    updateInfoPanelText();
}

function setupEventListeners() {
    loginBtn.addEventListener('click', () => openModal('login'));
    registerBtn.addEventListener('click', () => openModal('register'));
    logoutBtn.addEventListener('click', handleLogout);
    findMeBtn.addEventListener('click', handleFindMeClick);
    recordBtn.addEventListener('click', handleRecordClick);
    authModal.querySelector('.close-btn').addEventListener('click', () => authModal.style.display = 'none');
    authModal.addEventListener('click', e => { if (e.target === authModal) authModal.style.display = 'none'; });
    authForm.addEventListener('submit', handleAuthFormSubmit);
}

// --- NEW/RESTORED CORE FUNCTIONS ---

// RESTORED: This function was missing.
function updateStatus(message, type = 'info', duration = 0) {
    if (!statusMessageEl) return;
    statusMessageEl.textContent = message;
    statusMessageEl.className = type;
    if (duration > 0) {
        setTimeout(() => {
            if (statusMessageEl.textContent === message) {
                statusMessageEl.textContent = '';
                statusMessageEl.className = '';
            }
        }, duration);
    }
}

async function fetchEchoesForCurrentView() {
    const center = map.getBounds().getCenter();
    updateStatus("Scanning for echoes...", "info");
    try {
        const response = await fetch(`${API_URL}/echoes?lat=${center.lat}&lng=${center.lng}`);
        if (!response.ok) throw new Error("Server could not fetch echoes.");
        currentEchoesInView = await response.json();
        renderMapMarkers(currentEchoesInView);
        renderNearbyList(currentEchoesInView);
        updateStatus(currentEchoesInView.length > 0 ? `${currentEchoesInView.length} echoes found in this area.` : "No echoes found here. Be the first!", "info", 4000);
    } catch (err) {
        updateStatus("Could not fetch echoes.", "error", 4000);
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
        item.innerHTML = `
            <div class="info-row">
                <span class="location-name">${locationDisplayName}</span>
                <span class="date-info">by ${echo.username || 'anonymous'}</span>
            </div>
            <audio controls preload="metadata" src="${echo.audio_url}" onplay="window.keepEchoAlive(${echo.id})"></audio>
            <div class="actions-row">
                 <span class="date-info">Recorded: ${recordedDateTime}</span>
            </div>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.tagName !== 'AUDIO' && !e.target.closest('audio')) {
                handleListItemClick(echo.id);
            }
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

function handleListItemClick(echoId) {
    const marker = echoMarkersMap.get(echoId);
    if (marker) {
        map.flyTo(marker.getLatLng(), map.getZoom() < 16 ? 16 : map.getZoom());
        highlightEcho(echoId);
    }
}

function handleMarkerClick(echoId) {
    const listItem = nearbyEchoesList.querySelector(`.my-echo-item[data-echo-id='${echoId}']`);
    if (listItem) {
        listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightEcho(echoId);
    }
}

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

function clearNearbyListAndMarkers() {
    currentEchoesInView = [];
    markers.clearLayers();
    echoMarkersMap.clear();
    renderNearbyList([]);
}

// --- AUTH, LOCATION, AND RECORDING FUNCTIONS ---

window.keepEchoAlive = async (id) => {
    try {
        fetch(`${API_URL}/api/echoes/${id}/play`, { method: "POST" });
        const marker = echoMarkersMap.get(id);
        if (marker) {
            const echoData = currentEchoesInView.find(e => e.id === id);
            if (echoData) echoData.last_played_at = new Date().toISOString();
            marker.setIcon(createHealthIcon(100, id === highlightedEchoId));
        }
    } catch (err) { console.error("Failed to send keep-alive ping:", err); }
};

function onLocationUpdate(position) {
    currentUserPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
    const latLng = [currentUserPosition.lat, currentUserPosition.lng];
    if (userMarker) userMarker.setLatLng(latLng);
    else userMarker = L.marker(latLng, { icon: userLocationIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    const latStr = currentUserPosition.lat.toFixed(4);
    const lngStr = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latStr}_${lngStr}`;
    updateInfoPanelText();
}

function handleFindMeClick() {
    updateStatus("Locating...", "info");
    if (!("geolocation" in navigator)) return updateStatus("Geolocation not supported.", "error", 3000);
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(position => {
        onLocationUpdate(position);
        map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16);
        startLocationWatcher();
    }, onLocationError, options);
}

async function handleRecordClick() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        clearTimeout(recordingTimer);
        return;
    }
    updateStatus("Getting location...", "info");
    if (!('geolocation' in navigator)) return updateStatus("Geolocation not supported.", "error", 3000);
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(
        position => {
            onLocationUpdate(position);
            map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16);
            startRecordingProcess();
        },
        err => {
            onLocationError(err);
            updateStatus("Could not get location.", "error", 4000);
        },
        options
    );
}

async function startRecordingProcess() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = uploadAndSaveEcho;
        mediaRecorder.start();
        updateStatus("Recording...", "success");
        recordBtn.textContent = `Stop (${MAX_RECORDING_SECONDS}s)`;
        recordBtn.classList.add("is-recording");
        let secondsLeft = MAX_RECORDING_SECONDS;
        recordingTimer = setInterval(() => {
            secondsLeft--;
            recordBtn.textContent = `Stop (${secondsLeft}s)`;
            if (secondsLeft <= 0) {
                mediaRecorder.stop();
                clearTimeout(recordingTimer);
            }
        }, 1000);
    } catch (e) {
        console.error("Mic error:", e);
        updateStatus("Could not access mic.", "error", 3000);
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function uploadAndSaveEcho() {
    recordBtn.textContent = "Record Echo";
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
    updateStatus("Processing...", "info");
    clearTimeout(recordingTimer);
    if (audioChunks.length === 0) {
        updateStatus("Recording too short.", "error", 3000);
        recordBtn.disabled = !userToken;
        return;
    }
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;
    try {
        updateStatus("Preparing upload...", "info");
        const presignedResponse = await fetch(`${API_URL}/presigned-url`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: fileName, fileType: audioBlob.type })
        });
        if (!presignedResponse.ok) throw new Error(`Presigned URL failed: ${await presignedResponse.text()}`);
        const { url: uploadUrl } = await presignedResponse.json();
        updateStatus("Uploading...", "info");
        const uploadResponse = await fetch(uploadUrl, { method: "PUT", body: audioBlob, headers: { "Content-Type": audioBlob.type } });
        if (!uploadResponse.ok) throw new Error("Upload to R2 failed");
        const audioUrl = `${R2_PUBLIC_URL_BASE}/${fileName}`;
        updateStatus("Saving...", "info");
        const audioBase64 = await blobToBase64(audioBlob);
        const saveResponse = await fetch(`${API_URL}/echoes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
            body: JSON.stringify({
                w3w_address: currentBucketKey, audio_url: audioUrl, lat: currentUserPosition.lat, lng: currentUserPosition.lng, audio_blob_base64: audioBase64
            })
        });
        if (!saveResponse.ok) throw new Error(`Save metadata failed: ${await saveResponse.text()}`);
        updateStatus("Echo saved successfully!", "success", 3000);
        fetchEchoesForCurrentView();
    } catch (err) {
        console.error("Full echo process failed:", err);
        updateStatus(`Error: ${err.message}`, "error", 5000);
    } finally {
        updateInfoPanelText();
    }
}

function onLocationError(error) { updateStatus(`Error: ${error.message}`, "error", 4000); updateInfoPanelText(); }
function startLocationWatcher() { if (locationWatcherId) navigator.geolocation.clearWatch(locationWatcherId); if ("geolocation" in navigator) { const options = { enableHighAccuracy: true, timeout: 27000, maximumAge: 30000 }; locationWatcherId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, options); } }
function updateInfoPanelText() { recordBtn.disabled = !userToken || !currentUserPosition; }

// FIXED: This function now correctly finds the modal's title and button.
function openModal(mode) {
    modalError.textContent = "";
    authForm.reset();
    if (mode === 'login') {
        modalTitle.textContent = "Login";
        modalSubmitBtn.textContent = "Login";
        authForm.dataset.mode = "login";
    } else {
        modalTitle.textContent = "Register";
        modalSubmitBtn.textContent = "Register";
        authForm.dataset.mode = "register";
    }
    authModal.style.display = "flex";
}

function checkLoginState() { userToken = localStorage.getItem("echoes_token"); if (userToken) { try { const payload = JSON.parse(atob(userToken.split(".")[1])); loggedInUser = payload.user.username; updateUIAfterLogin(); } catch (err) { console.error("Failed to decode token", err); handleLogout(); } } else { updateUIAfterLogout(); } updateInfoPanelText(); }
function handleLogout() { localStorage.removeItem("echoes_token"); userToken = null; loggedInUser = null; updateUIAfterLogout(); if (locationWatcherId) { navigator.geolocation.clearWatch(locationWatcherId); locationWatcherId = null; } }
function updateUIAfterLogin() { welcomeMessage.textContent = `Welcome, ${loggedInUser}`; if (myEchoesBtn) myEchoesBtn.style.display = 'inline-block'; loginBtn.style.display = "none"; registerBtn.style.display = "none"; logoutBtn.style.display = "inline-block"; updateInfoPanelText(); }
function updateUIAfterLogout() { welcomeMessage.textContent = ""; if (myEchoesBtn) myEchoesBtn.style.display = 'none'; loginBtn.style.display = "inline-block"; registerBtn.style.display = "inline-block"; logoutBtn.style.display = "none"; updateInfoPanelText(); }
async function handleAuthFormSubmit(e) { e.preventDefault(); modalError.textContent = ""; const username = usernameInput.value; const password = passwordInput.value; const mode = authForm.dataset.mode; const endpoint = mode === 'login' ? "/api/users/login" : "/api/users/register"; try { const response = await fetch(`${API_URL}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "An unknown error occurred."); if (mode === 'register') { modalError.textContent = "Registration successful! Please log in."; authForm.reset(); openModal('login'); } else { localStorage.setItem("echoes_token", data.token); checkLoginState(); authModal.style.display = "none"; } } catch (err) { modalError.textContent = err.message; } }