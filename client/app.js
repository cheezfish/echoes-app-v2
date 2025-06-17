// client/app.js - FINAL ROBUST & READABLE VERSION

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

const MAX_RECORDING_SECONDS = 60;

const userLocationIcon = L.divIcon({
    className: 'user-location-marker',
    html: `<div class="pulse"></div><img src="https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff"/>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

const echoIconFresh = L.icon({ iconUrl: "https://api.iconify.design/mdi:fire.svg?color=%23ffc107", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconStable = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%23dc3545", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconFading = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%236c757d", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });

let mapContainer, infoPanelTitle, recordBtn, loginBtn, registerBtn, logoutBtn, welcomeMessage, authModal, closeModalBtn, authForm, modalTitle, modalSubmitBtn, modalError, usernameInput, passwordInput, clusterModal, closeClusterModalBtn, clusterEchoList, findMeBtn, statusMessageEl;

let map, mediaRecorder, audioChunks = [], currentUserPosition = null, currentBucketKey = "", markers, userToken = null, loggedInUser = null, echoMarkersMap = new Map(), userMarker;
let recordingTimer;
let locationWatcherId = null;

document.addEventListener('DOMContentLoaded', () => {
    mapContainer = document.getElementById("map");
    infoPanelTitle = document.getElementById("info-panel-title");
    recordBtn = document.getElementById("record-btn");
    loginBtn = document.getElementById("login-btn");
    registerBtn = document.getElementById("register-btn");
    logoutBtn = document.getElementById("logout-btn");
    welcomeMessage = document.getElementById("welcome-message");
    authModal = document.getElementById("auth-modal");
    closeModalBtn = document.querySelector("#auth-modal .close-btn");
    authForm = document.getElementById("auth-form");
    modalTitle = document.getElementById("modal-title");
    modalSubmitBtn = document.getElementById("modal-submit-btn");
    modalError = document.getElementById("modal-error");
    usernameInput = document.getElementById("username");
    passwordInput = document.getElementById("password");
    clusterModal = document.getElementById("cluster-modal");
    closeClusterModalBtn = document.getElementById("close-cluster-modal-btn");
    clusterEchoList = document.getElementById("cluster-echo-list");
    findMeBtn = document.getElementById("find-me-btn");
    statusMessageEl = document.getElementById("status-message");

    initializeApp();
});

function initializeApp() {
    setupEventListeners();
    checkLoginState();
    map = L.map(mapContainer, { zoomControl: true, attributionControl: false }).setView([20, 0], 2);
    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=oeJYklnaUPpZgpHgTszf', {
        maxZoom: 20,
        attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.control.attribution({ position: 'topright' }).addTo(map);

    markers = L.markerClusterGroup({
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            let c = ' marker-cluster-';
            if (count < 10) { c += 'small'; } 
            else if (count < 100) { c += 'medium'; } 
            else { c += 'large'; }
            return new L.DivIcon({ html: `<div><span>${count}</span></div>`, className: 'marker-cluster' + c, iconSize: new L.Point(40, 40) });
        }
    });
    markers.on('clusterclick', handleClusterClick);
    map.addLayer(markers);
    updateInfoPanelText();
}

function onLocationUpdate(position) {
    currentUserPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
    const latLng = [currentUserPosition.lat, currentUserPosition.lng];

    if (userMarker) {
        userMarker.setLatLng(latLng);
    } else {
        userMarker = L.marker(latLng, { icon: userLocationIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    }
    
    if (document.hasFocus()) {
      updateStatus('Location updated.', 'info', 1500);
    }

    const latStr = currentUserPosition.lat.toFixed(4);
    const lngStr = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latStr}_${lngStr}`;
    updateInfoPanelText();
}

function onLocationError(error) {
    updateStatus(`Error: ${error.message}`, "error", 4000);
    updateInfoPanelText();
}

function startLocationWatcher() {
    if (locationWatcherId) {
        navigator.geolocation.clearWatch(locationWatcherId);
    }
    if ("geolocation" in navigator) {
        const options = { enableHighAccuracy: true, timeout: 27000, maximumAge: 30000 };
        locationWatcherId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, options);
    }
}

function handleFindMeClick() {
    updateStatus("Locating your position...", "info");
    if (!("geolocation" in navigator)) {
        return updateStatus("Geolocation is not supported.", "error", 3000);
    }
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(position => {
        onLocationUpdate(position);
        map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16);
        fetchAllEchoes(currentUserPosition);
        startLocationWatcher();
    }, onLocationError, options);
}

async function handleRecordClick() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        clearTimeout(recordingTimer);
        return;
    }
    updateStatus("Getting your precise location...", "info");
    if (!('geolocation' in navigator)) {
        return updateStatus("Geolocation is not supported.", "error", 3000);
    }
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(
        position => {
            onLocationUpdate(position);
            map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16);
            startRecordingProcess();
        },
        err => {
            onLocationError(err);
            updateStatus("Could not get location. Cannot record echo.", "error", 4000);
        },
        options
    );
}

async function startRecordingProcess() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { audioChunks.push(e.data); };
        mediaRecorder.onstop = uploadAndSaveEcho;
        mediaRecorder.start();
        updateStatus("Recording...", "success");
        recordBtn.textContent = `Stop Recording (${MAX_RECORDING_SECONDS}s)`;
        recordBtn.classList.add("is-recording");
        let secondsLeft = MAX_RECORDING_SECONDS;
        recordingTimer = setInterval(() => {
            secondsLeft--;
            recordBtn.textContent = `Stop Recording (${secondsLeft}s)`;
            if (secondsLeft <= 0) {
                mediaRecorder.stop();
                clearTimeout(recordingTimer);
            }
        }, 1000);
    } catch (e) {
        console.error("Mic error:", e);
        updateStatus("Could not access microphone.", "error", 3000);
    }
}

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

function setupEventListeners() {
    loginBtn.addEventListener('click', () => openModal('login'));
    registerBtn.addEventListener('click', () => openModal('register'));
    logoutBtn.addEventListener('click', handleLogout);
    closeModalBtn.addEventListener('click', () => authModal.style.display = 'none');
    closeClusterModalBtn.addEventListener('click', () => clusterModal.style.display = 'none');
    authModal.addEventListener('click', e => { if (e.target === authModal) authModal.style.display = 'none'; });
    clusterModal.addEventListener('click', e => { if (e.target === clusterModal) clusterModal.style.display = 'none'; });
    authForm.addEventListener('submit', handleAuthFormSubmit);
    recordBtn.addEventListener('click', handleRecordClick);
    findMeBtn.addEventListener('click', handleFindMeClick);
}

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
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "An unknown error occurred.");
        }
        if (mode === 'register') {
            modalError.textContent = "Registration successful! Please log in.";
            authForm.reset();
            openModal('login');
        } else {
            localStorage.setItem("echoes_token", data.token);
            checkLoginState();
            authModal.style.display = "none";
        }
    } catch (err) {
        modalError.textContent = err.message;
    }
}

function checkLoginState() {
    const token = localStorage.getItem("echoes_token");
    if (token) {
        userToken = token;
        try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            loggedInUser = payload.user.username;
            updateUIAfterLogin();
        } catch (err) {
            console.error("Failed to decode token", err);
            handleLogout();
        }
    } else {
        updateUIAfterLogout();
    }
    updateInfoPanelText();
}

function handleLogout() {
    localStorage.removeItem("echoes_token");
    userToken = null;
    loggedInUser = null;
    updateUIAfterLogout();
    if (locationWatcherId) {
        navigator.geolocation.clearWatch(locationWatcherId);
        locationWatcherId = null;
    }
}

function updateUIAfterLogin() {
    welcomeMessage.textContent = `Welcome, ${loggedInUser}`;
    loginBtn.style.display = "none";
    registerBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    updateInfoPanelText();
}

function updateUIAfterLogout() {
    welcomeMessage.textContent = "";
    loginBtn.style.display = "inline-block";
    registerBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    updateInfoPanelText();
}

// ===================
//  MODIFIED FUNCTION
// ===================
function handleClusterClick(a) {
    const childMarkers = a.layer.getAllChildMarkers();
    const echoes = childMarkers.map(marker => marker.echoData);
    echoes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    clusterEchoList.innerHTML = "";
    echoes.forEach(echo => {
        const item = document.createElement("div");
        item.className = "echo-item";
        
        const author = echo.username ? `<span class="echo-author">by ${echo.username}</span>` : `<span class="echo-author">by an anonymous user</span>`;
        const date = `<span class="echo-date">Recorded: ${new Date(echo.created_at).toLocaleDateString()}</span>`;
        
        // FIX: Added preload="none" to the audio tag to prevent the Android "chime" issue.
        // Also using the new HTML structure for better styling.
        item.innerHTML = `
            <div class="echo-info">
                ${author}
                ${date}
            </div>
            <audio controls preload="none" onplay="keepEchoAlive(${echo.id})" src="${echo.audio_url}"></audio>
        `;
        clusterEchoList.appendChild(item);
    });
    clusterModal.style.display = "flex";
}

async function fetchAllEchoes(position) {
    if (!position || !position.lat || !position.lng) return;
    markers.clearLayers();
    echoMarkersMap.clear();
    updateStatus("Fetching nearby echoes...", "info");
    try {
        const response = await fetch(`${API_URL}/echoes?lat=${position.lat}&lng=${position.lng}`);
        if (!response.ok) throw new Error("Failed to fetch echoes");
        const echoes = await response.json();
        renderEchoesOnMap(echoes);
        updateStatus(
            echoes.length > 0 ? `${echoes.length} echo(s) found nearby.` : "No echoes found nearby. Be the first!",
            echoes.length > 0 ? "success" : "info",
            3000
        );
    } catch (err) {
        console.error("Failed to fetch nearby echoes:", err);
        updateStatus("Could not fetch echoes.", "error", 3000);
    }
}

function renderEchoesOnMap(echoes) {
    echoes.forEach(echo => {
        if (echo.lat && echo.lng) {
            const age = new Date() - new Date(echo.last_played_at);
            let icon = age < 1728e5 ? echoIconFresh : (age < 1296e6 ? echoIconStable : echoIconFading);
            const marker = L.marker([echo.lat, echo.lng], { icon: icon });
            marker.echoData = echo;
            marker.bindPopup(createEchoPopup(echo));
            echoMarkersMap.set(echo.id, marker);
            markers.addLayer(marker);
        }
    });
}

function createEchoPopup(echo) {
    const author = echo.username ? `by ${echo.username}` : "by an anonymous user";
    // FIX: Added preload="none" here too, just in case.
    return `<h3>Echo Location</h3><p>Recorded on: ${new Date(echo.created_at).toLocaleDateString()} ${author}</p><audio controls preload="none" onplay="keepEchoAlive(${echo.id})" src="${echo.audio_url}"></audio>`;
}

window.keepEchoAlive = async (id) => {
    try {
        fetch(`${API_URL}/api/echoes/${id}/play`, { method: "POST" });
        const marker = echoMarkersMap.get(id);
        if (marker) {
            marker.setIcon(echoIconFresh);
        }
    } catch (err) {
        console.error("Failed to send keep-alive ping:", err);
    }
};

function updateInfoPanelText() {
    if (currentUserPosition) {
        if (userToken) {
            infoPanelTitle.textContent = "You are ready to record an echo.";
            recordBtn.disabled = false;
        } else {
            infoPanelTitle.textContent = "Please Login or Register to leave an echo.";
            recordBtn.disabled = true;
        }
    } else {
        infoPanelTitle.textContent = "Click the 'Find Me' button on the map to start exploring.";
        recordBtn.disabled = true;
    }
}

async function uploadAndSaveEcho() {
    recordBtn.textContent = "Record Echo";
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
    updateStatus("Processing...", "info");
    clearTimeout(recordingTimer);

    if (audioChunks.length === 0) {
        updateStatus("Recording too short.", "error", 3000);
        recordBtn.disabled = false;
        return;
    }
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;

    try {
        updateStatus("Preparing upload...", "info");
        const presignedResponse = await fetch(`${API_URL}/presigned-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: fileName, fileType: audioBlob.type })
        });
        if (!presignedResponse.ok) throw new Error(`Presigned URL failed: ${await presignedResponse.text()}`);
        const { url: uploadUrl } = await presignedResponse.json();

        updateStatus("Uploading...", "info");
        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            body: audioBlob,
            headers: { "Content-Type": audioBlob.type }
        });
        if (!uploadResponse.ok) throw new Error("Upload to R2 failed");

        const audioUrl = `${R2_PUBLIC_URL_BASE}/${fileName}`;
        updateStatus("Saving...", "info");
        const saveResponse = await fetch(`${API_URL}/echoes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
            body: JSON.stringify({
                w3w_address: currentBucketKey,
                audio_url: audioUrl,
                lat: currentUserPosition.lat,
                lng: currentUserPosition.lng
            })
        });
        if (!saveResponse.ok) throw new Error(`Save metadata failed: ${await saveResponse.text()}`);
        const newEcho = await saveResponse.json();
        
        updateStatus("Echo saved successfully!", "success", 3000);
        newEcho.username = loggedInUser;
        renderEchoesOnMap([newEcho]);

    } catch (err) {
        console.error("Full echo process failed:", err);
        updateStatus(`Error: ${err.message}`, "error", 5000);
    } finally {
        updateInfoPanelText();
        recordBtn.disabled = !userToken || !currentUserPosition;
    }
}