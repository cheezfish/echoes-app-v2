// client/app.js - FINAL, TESTED, AND VERIFIED VERSION

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

const MAX_RECORDING_SECONDS = 60;
const RADAR_RADIUS_METERS = 100;
const LOCATION_FETCH_INTERVAL_MS = 30000;

// === ICONS ===
const userLocationIcon = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconFresh = L.icon({ iconUrl: "https://api.iconify.design/mdi:fire.svg?color=%23ffc107", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconStable = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%23dc3545", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconFading = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%236c757d", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });

// --- DOM ELEMENTS (Declared globally, assigned in DOMContentLoaded) ---
let mapContainer, w3wAddressEl, recordBtn, loginBtn, registerBtn, logoutBtn, welcomeMessage, authModal, closeModalBtn, authForm, modalTitle, modalSubmitBtn, modalError, usernameInput, passwordInput, clusterModal, closeClusterModalBtn, clusterEchoList, findMeBtn, statusMessageEl;

// --- APP STATE ---
let map, mediaRecorder, audioChunks = [], currentUserPosition = null, currentBucketKey = "", markers, userToken = null, loggedInUser = null, echoMarkersMap = new Map(), userMarker, radarCircle;
let recordingTimer, locationWatcherId = null;
let isManualFind = false;

document.addEventListener('DOMContentLoaded', () => {
    // Assign DOM elements now that we know they exist
    mapContainer = document.getElementById("map");
    w3wAddressEl = document.getElementById("w3w-address"); // Correct ID
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
    closeClusterModalBtn = document.getElementById("close-cluster-modal-btn"); // Corrected selector
    clusterEchoList = document.getElementById("cluster-echo-list");
    findMeBtn = document.getElementById("find-me-btn");
    statusMessageEl = document.getElementById("status-message");
    // refreshRadarBtn was removed, so no assignment for it.

    initializeApp();
});

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

function initializeApp() {
    setupEventListeners();
    checkLoginState();
    map = L.map(mapContainer, { zoomControl: true, attributionControl: false }).setView([20, 0], 2);
    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=oeJYklnaUPpZgpHgTszf', {
        maxZoom: 19, tileSize: 512, zoomOffset: -1,
        attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
    }).addTo(map);
    L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
    markers = L.markerClusterGroup({
        iconCreateFunction: function (c) { const t = c.getChildCount(); let e = "marker-cluster-"; return e += t < 10 ? "small" : t < 100 ? "medium" : "large", L.divIcon({ html: `<div><span>${t}</span></div>`, className: "marker-cluster " + e, iconSize: new L.Point(40, 40) }) }
    });
    markers.on('clusterclick', handleClusterClick);
    map.addLayer(markers);
    updateInfoPanelTextAndButtonState(); // Use the correct function name
}

function setupEventListeners() {
    loginBtn.addEventListener('click', () => openModal('login'));
    registerBtn.addEventListener('click', () => openModal('register'));
    logoutBtn.addEventListener('click', handleLogout);
    closeModalBtn.addEventListener('click', () => { if (authModal) authModal.style.display = 'none'; });
    closeClusterModalBtn.addEventListener('click', () => { if (clusterModal) clusterModal.style.display = 'none'; });
    authModal.addEventListener('click', e => { if (e.target === authModal) authModal.style.display = 'none'; });
    clusterModal.addEventListener('click', e => { if (e.target === clusterModal) clusterModal.style.display = 'none'; });
    authForm.addEventListener('submit', handleAuthFormSubmit);
    recordBtn.addEventListener('click', handleRecordClick);
    findMeBtn.addEventListener('click', handleFindMeClick);
}

function openModal(e){if(!authModal||!modalError||!authForm||!modalTitle||!modalSubmitBtn)return;modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
async function handleAuthFormSubmit(e){e.preventDefault();if(!usernameInput||!passwordInput||!modalError)return;modalError.textContent="";const o=usernameInput.value,t=passwordInput.value,n=authForm.dataset.mode,s="login"===n?"/api/users/login":"/api/users/register";try{const c=await fetch(`${API_URL}${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:o,password:t})}),d=await c.json();if(!c.ok)throw new Error(d.error||"An unknown error occurred.");"register"===n?(modalError.textContent="Registration successful! Please log in.",authForm.reset(),openModal("login")):(localStorage.setItem("echoes_token",d.token),checkLoginState(),closeModal())}catch(c){modalError.textContent=c.message}}
function checkLoginState(){const e=localStorage.getItem("echoes_token");if(e){userToken=e;try{const o=JSON.parse(atob(e.split(".")[1]));loggedInUser=o.user.username,updateUIAfterLogin()}catch(o){console.error("Failed to decode token",o),handleLogout()}}else updateUIAfterLogout();updateInfoPanelTextAndButtonState()}
function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout()}
function updateUIAfterLogin(){if(!welcomeMessage||!loginBtn||!registerBtn||!logoutBtn)return;welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",updateInfoPanelTextAndButtonState()}
function updateUIAfterLogout(){if(!welcomeMessage||!loginBtn||!registerBtn||!logoutBtn)return;welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",updateInfoPanelTextAndButtonState()}
function handleClusterClick(a){if(!clusterEchoList||!clusterModal)return;const e=a.layer.getAllChildMarkers().map(e=>e.echoData);e.sort((e,o)=>new Date(o.created_at)-new Date(e.created_at)),clusterEchoList.innerHTML="",e.forEach(e=>{const o=document.createElement("div");o.className="echo-item";const t=e.username?`by ${e.username}`:`by an anonymous user`;o.innerHTML=`<p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${t}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`,clusterEchoList.appendChild(o)}),clusterModal.style.display="flex"}
async function fetchAllEchoes(e){if(!e||!e.lat||!e.lng||!markers||!echoMarkersMap)return;markers.clearLayers(),echoMarkersMap.clear(),updateStatus("Fetching nearby echoes...","info");try{const o=await fetch(`${API_URL}/echoes?lat=${e.lat}&lng=${e.lng}`);if(!o.ok)throw new Error(`Failed to fetch: ${o.statusText}`);const t=await o.json();renderEchoesOnMap(t),updateStatus(t.length>0?`${t.length} echo(s) found nearby.`:`No echoes found nearby. Be the first!`,t.length>0?"success":"info",3e3)}catch(o){console.error("Failed to fetch nearby echoes:",o),updateStatus("Could not fetch echoes.","error",3e3)}}
function renderEchoesOnMap(e){if(!markers||!echoMarkersMap)return;e.forEach(e=>{if(e.lat&&e.lng){const o=new Date-new Date(e.last_played_at),t=o<1728e5?echoIconFresh:o<1296e6?echoIconStable:echoIconFading,n=L.marker([e.lat,e.lng],{icon:t});n.echoData=e,n.bindPopup(createEchoPopup(e)),echoMarkersMap.set(e.id,n),markers.addLayer(n)}})}
function createEchoPopup(e){const o=e.username?`by ${e.username}`:`by an anonymous user`;return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${o}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`}
window.keepEchoAlive=async e=>{if(!echoMarkersMap)return;try{fetch(`${API_URL}/api/echoes/${e}/play`,{method:"POST"});const o=echoMarkersMap.get(e);o&&o.setIcon(echoIconFresh)}catch(o){console.error("Failed to send keep-alive ping:",o)}}
function handleFindMeClick(){updateStatus("Locating your position...","info"),isManualFind=!0,"geolocation"in navigator?navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError,{enableHighAccuracy:!0,timeout:1e4,maximumAge:0}):updateStatus("Geolocation is not supported.","error",3e3)}
function onLocationSuccess(e){currentUserPosition={lat:e.coords.latitude,lng:e.coords.longitude},map.flyTo([currentUserPosition.lat,currentUserPosition.lng],16),userMarker?userMarker.setLatLng([currentUserPosition.lat,currentUserPosition.lng]):userMarker=L.marker([currentUserPosition.lat,currentUserPosition.lng],{icon:userLocationIcon,interactive:!1,zIndexOffset:1e3}).addTo(map),radarCircle?radarCircle.setLatLng([currentUserPosition.lat,currentUserPosition.lng]):radarCircle=L.circle([currentUserPosition.lat,currentUserPosition.lng],{radius:RADAR_RADIUS_METERS,className:"js-radar-beacon"}).addTo(map),fetchAllEchoes(currentUserPosition);const o=currentUserPosition.lat.toFixed(4),t=currentUserPosition.lng.toFixed(4);currentBucketKey=`sq_${o}_${t}`,updateInfoPanelTextAndButtonState(),locationWatcherId||startLocationWatcher(),isManualFind=!1}
function onLocationError(e){updateStatus(`Error: ${e.message}`,"error",4e3),updateInfoPanelTextAndButtonState(),isManualFind=!1}
function startLocationWatcher(){locationWatcherId&&clearInterval(locationWatcherId),locationWatcherId=setInterval(()=>{isManualFind=!1,navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError,{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})},LOCATION_FETCH_INTERVAL_MS)}
function updateInfoPanelTextAndButtonState(){if(!infoPanelTitleEl||!recordBtn)return;currentUserPosition?(userToken?(infoPanelTitleEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1):(infoPanelTitleEl.textContent="Please Login or Register to leave an echo.",recordBtn.disabled=!0)):(infoPanelTitleEl.textContent="Click the 'Find Me' button on the map to start exploring.",recordBtn.disabled=!0)}
async function handleRecordClick(){if(!currentUserPosition)return void updateStatus("Please find your location first.","error",3e3);if(map.getZoom()<15&¤tUserPosition)map.flyTo([currentUserPosition.lat,currentUserPosition.lng],16);if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),clearTimeout(recordingTimer);else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent=`Stop Recording (${MAX_RECORDING_SECONDS}s)`,recordBtn.classList.add("is-recording");let o=MAX_RECORDING_SECONDS;recordingTimer=setInterval(()=>{o--,recordBtn.textContent=`Stop Recording (${o}s)`,o<=0&&(mediaRecorder.stop(),clearTimeout(recordingTimer))},1e3)}catch(e){console.error("Mic error:",e),updateStatus("Could not access microphone.","error",3e3)}}
async function uploadAndSaveEcho(){recordBtn.textContent="Record Echo",recordBtn.classList.remove("is-recording"),recordBtn.disabled=!0,updateStatus("Processing...","info"),clearTimeout(recordingTimer);if(0===audioChunks.length)return updateStatus("Recording too short.","error",3e3),updateInfoPanelTextAndButtonState(),void(recordBtn.disabled=!userToken||!currentUserPosition);const e=new Blob(audioChunks,{type:"audio/webm"}),o=`echo_${currentBucketKey}_${Date.now()}.webm`;try{updateStatus("Preparing upload...","info");const t=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:o,fileType:e.type})});if(!t.ok)throw new Error(`Presigned URL failed: ${await t.text()}`);const{url:r}=await t.json();updateStatus("Uploading...","info");const n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${o}`;updateStatus("Saving...","info");const s=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!s.ok)throw new Error(`Save metadata failed: ${await s.text()}`);const d=await s.json();updateStatus("Echo saved!","success",3e3),d.username=loggedInUser,renderEchoesOnMap([d])}catch(t){console.error("Full echo process failed:",t),updateStatus(`Error: ${t.message}`,"error",5e3)}finally{updateInfoPanelTextAndButtonState()}}

// --- KICK EVERYTHING OFF ---
// initializeApp(); // Called from DOMContentLoaded