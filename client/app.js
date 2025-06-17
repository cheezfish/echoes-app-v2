// client/app.js - FINAL ROBUST VERSION (DOMContentLoaded)

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

const MAX_RECORDING_SECONDS = 60;
const RADAR_RADIUS_METERS = 100;

// FIX: Centered iconAnchor to align the icon with the radar pulse.
const userLocationIcon = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconFresh = L.icon({ iconUrl: "https://api.iconify.design/mdi:fire.svg?color=%23ffc107", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconStable = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%23dc3545", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconFading = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%236c757d", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });

let mapContainer, infoPanelTitle, recordBtn, loginBtn, registerBtn, logoutBtn, welcomeMessage, authModal, closeModalBtn, authForm, modalTitle, modalSubmitBtn, modalError, usernameInput, passwordInput, clusterModal, closeClusterModalBtn, clusterEchoList, findMeBtn, statusMessageEl;

let map, mediaRecorder, audioChunks = [], currentUserPosition = null, currentBucketKey = "", markers, userToken = null, loggedInUser = null, echoMarkersMap = new Map(), userMarker, radarCircle;
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

    // FIX: Set attributionControl to false to remove the default one.
    map = L.map(mapContainer, { zoomControl: true, attributionControl: false }).setView([20, 0], 2);

    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=oeJYklnaUPpZgpHgTszf', {
        maxZoom: 20,
        attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // FIX: Add a new attribution control to the top right of the map.
    L.control.attribution({ position: 'topright' }).addTo(map);

    markers = L.markerClusterGroup({
        iconCreateFunction: function(c){const t=c.getChildCount();let e="marker-cluster-";return e+=t<10?"small":t<100?"medium":"large",L.divIcon({html:`<div><span>${t}</span></div>`,className:"marker-cluster "+e,iconSize:new L.Point(40,40)})}
    });
    markers.on('clusterclick', handleClusterClick);
    map.addLayer(markers);
    updateInfoPanelText();
}

// --- NEW LOCATION HANDLING LOGIC ---

/**
 * Passively updates user's position data and map markers without moving the map.
 * This is used by the background location watcher.
 * @param {GeolocationPosition} position - The position object from the Geolocation API.
 */
function onLocationUpdate(position) {
    currentUserPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
    const latLng = [currentUserPosition.lat, currentUserPosition.lng];

    if (userMarker) {
        userMarker.setLatLng(latLng);
    } else {
        userMarker = L.marker(latLng, { icon: userLocationIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    }

    if (radarCircle) {
        radarCircle.setLatLng(latLng);
    } else {
        radarCircle = L.circle(latLng, { radius: RADAR_RADIUS_METERS, className: "js-radar-beacon" }).addTo(map);
    }

    const latStr = currentUserPosition.lat.toFixed(4);
    const lngStr = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latStr}_${lngStr}`;
    updateInfoPanelText(); // Enable record button etc.
}

/**
 * Handles geolocation errors.
 * @param {GeolocationPositionError} error - The error object.
 */
function onLocationError(error) {
    updateStatus(`Error: ${error.message}`, "error", 4000);
    updateInfoPanelText();
}

/**
 * FIX: Starts a passive location watcher that updates the user's icon on the map
 * in the background without forcing the map to re-center.
 */
function startLocationWatcher() {
    if (locationWatcherId) {
        navigator.geolocation.clearWatch(locationWatcherId);
    }
    if ("geolocation" in navigator) {
        const options = { enableHighAccuracy: true, timeout: 27000, maximumAge: 30000 };
        locationWatcherId = navigator.geolocation.watchPosition(
            onLocationUpdate, // Passively update marker
            onLocationError,
            options
        );
    }
}

/**
 * FIX: This function is now only for the "Find Me" button click.
 * It gets a fresh location, ZOOMS the map, fetches echoes, and starts the watcher.
 */
function handleFindMeClick() {
    updateStatus("Locating your position...", "info");
    if (!("geolocation" in navigator)) {
        return updateStatus("Geolocation is not supported.", "error", 3000);
    }

    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(position => {
        onLocationUpdate(position); // Update position, marker, etc.
        map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16); // Fly the map to the new position.
        fetchAllEchoes(currentUserPosition); // Fetch echoes for this location.
        startLocationWatcher(); // Start the passive background watcher.
    }, onLocationError, options);
}

/**
 * FIX: The "Record" button now also finds the user's current location and zooms to it
 * before starting the recording process.
 */
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
            startRecordingProcess(); // Proceed to record
        },
        err => {
            onLocationError(err);
            updateStatus("Could not get location. Cannot record echo.", "error", 4000);
        },
        options
    );
}

/**
 * The core logic for starting the audio recording, extracted for clarity.
 */
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
                mediaRecorder.stop(); // This will trigger the 'onstop' event
                clearTimeout(recordingTimer);
            }
        }, 1000);
    } catch (e) {
        console.error("Mic error:", e);
        updateStatus("Could not access microphone.", "error", 3000);
    }
}


// --- UNCHANGED FUNCTIONS BELOW ---

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

function openModal(e){modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
async function handleAuthFormSubmit(e){e.preventDefault(),modalError.textContent="";const o=usernameInput.value,t=passwordInput.value,n=authForm.dataset.mode,s="login"===n?"/api/users/login":"/api/users/register";try{const c=await fetch(`${API_URL}${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:o,password:t})}),d=await c.json();if(!c.ok)throw new Error(d.error||"An unknown error occurred.");"register"===n?(modalError.textContent="Registration successful! Please log in.",authForm.reset(),openModal("login")):(localStorage.setItem("echoes_token",d.token),checkLoginState(),authModal.style.display="none")}catch(c){modalError.textContent=c.message}}
function checkLoginState(){const e=localStorage.getItem("echoes_token");if(e){userToken=e;try{const o=JSON.parse(atob(e.split(".")[1]));loggedInUser=o.user.username,updateUIAfterLogin()}catch(o){console.error("Failed to decode token",o),handleLogout()}}else updateUIAfterLogout();updateInfoPanelText()}
function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout();if(locationWatcherId)navigator.geolocation.clearWatch(locationWatcherId),locationWatcherId=null;}
function updateUIAfterLogin(){welcomeMessage.textContent=`Welcome, ${loggedInUser}`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",updateInfoPanelText()}
function updateUIAfterLogout(){welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",updateInfoPanelText()}
function handleClusterClick(a){const e=a.layer.getAllChildMarkers().map(e=>e.echoData);e.sort((e,o)=>new Date(o.created_at)-new Date(e.created_at)),clusterEchoList.innerHTML="",e.forEach(e=>{const o=document.createElement("div");o.className="echo-item";const t=e.username?`by ${e.username}`:"by an anonymous user";o.innerHTML=`<p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${t}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`,clusterEchoList.appendChild(o)}),clusterModal.style.display="flex"}
async function fetchAllEchoes(e){if(!e||!e.lat||!e.lng)return;markers.clearLayers(),echoMarkersMap.clear();updateStatus("Fetching nearby echoes...", "info");try{const o=await fetch(`${API_URL}/echoes?lat=${e.lat}&lng=${e.lng}`);if(!o.ok)throw new Error("Failed to fetch echoes");const t=await o.json();renderEchoesOnMap(t),updateStatus(t.length>0?`${t.length} echo(s) found nearby.`:"No echoes found nearby. Be the first!",t.length>0?"success":"info",3e3)}catch(o){console.error("Failed to fetch nearby echoes:",o),updateStatus("Could not fetch echoes.","error",3e3)}}
function renderEchoesOnMap(e){e.forEach(e=>{if(e.lat&&e.lng){const o=new Date-new Date(e.last_played_at);let t=o<1728e5?echoIconFresh:o<1296e6?echoIconStable:echoIconFading;const n=L.marker([e.lat,e.lng],{icon:t});n.echoData=e,n.bindPopup(createEchoPopup(e)),echoMarkersMap.set(e.id,n),markers.addLayer(n)}})}
function createEchoPopup(e){const o=e.username?`by ${e.username}`:"by an anonymous user";return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${o}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`}
window.keepEchoAlive=async e=>{try{fetch(`${API_URL}/api/echoes/${e}/play`,{method:"POST"});const o=echoMarkersMap.get(e);o&&o.setIcon(echoIconFresh)}catch(o){console.error("Failed to send keep-alive ping:",o)}}
function updateInfoPanelText(){if(currentUserPosition){if(userToken){infoPanelTitle.textContent="You are ready to record an echo.";recordBtn.disabled=!1}else{infoPanelTitle.textContent="Please Login or Register to leave an echo.";recordBtn.disabled=!0}}else{infoPanelTitle.textContent="Click the 'Find Me' button on the map to start exploring.";recordBtn.disabled=!0}}
async function uploadAndSaveEcho(){recordBtn.textContent="Record Echo",recordBtn.classList.remove("is-recording"),recordBtn.disabled=!0,updateStatus("Processing...","info"),clearTimeout(recordingTimer);if(0===audioChunks.length)return updateStatus("Recording too short.","error",3e3),void(recordBtn.disabled=!1);const e=new Blob(audioChunks,{type:"audio/webm"}),o=`echo_${currentBucketKey}_${Date.now()}.webm`;try{updateStatus("Preparing upload...","info");const t=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:o,fileType:e.type})});if(!t.ok)throw new Error(`Presigned URL failed: ${await t.text()}`);const{url:r}=await t.json();updateStatus("Uploading...","info");const n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${o}`;updateStatus("Saving...","info");const s=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!s.ok)throw new Error(`Save metadata failed: ${await s.text()}`);const d=await s.json();updateStatus("Echo saved successfully!","success",3e3),d.username=loggedInUser,renderEchoesOnMap([d])}catch(t){console.error("Full echo process failed:",t),updateStatus(`Error: ${t.message}`,"error",5e3)}finally{updateInfoPanelText(),recordBtn.disabled=!userToken||!currentUserPosition}}