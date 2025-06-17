// client/app.js - FINAL VERSION WITH CORRECT DOM IDs AND STARTUP LOGIC

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
let mapContainer, infoPanelTitleEl, recordBtn, loginBtn, registerBtn, logoutBtn, welcomeMessage, authModal, closeModalBtn, authForm, modalTitle, modalSubmitBtn, modalError, usernameInput, passwordInput, clusterModal, closeClusterModalBtn, clusterEchoList, findMeBtn, statusMessageEl;

// --- APP STATE ---
let map, mediaRecorder, audioChunks = [], currentUserPosition = null, currentBucketKey = "", markers, userToken = null, loggedInUser = null, echoMarkersMap = new Map(), userMarker, radarCircle;
let recordingTimer, locationWatcherId = null;
let isManualFind = false;

document.addEventListener('DOMContentLoaded', () => {
    // Assign DOM elements now that we know they exist
    mapContainer = document.getElementById("map");
    infoPanelTitleEl = document.getElementById("info-panel-title"); // Uses the ID from index.html
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

    // CRITICAL: Check if all essential elements were found
    if (!mapContainer || !infoPanelTitleEl || !recordBtn || !loginBtn || !registerBtn || !logoutBtn || !findMeBtn || !authModal || !clusterModal) {
        console.error("CRITICAL ERROR: One or more essential HTML elements were not found. Check IDs in HTML and JS.");
        document.body.innerHTML = "<h1 style='color:red; text-align:center; margin-top: 50px;'>Critical Error: App cannot start. Check console.</h1>";
        return; // Stop execution
    }

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
    checkLoginState(); // This also calls updateInfoPanelTextAndButtonState
    map = L.map(mapContainer, { zoomControl: true, attributionControl: false }).setView([20, 0], 2);
    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=oeJYklnaUPpZgpHgTszf', { // Ensure your key is correct
        maxZoom: 19, tileSize: 512, zoomOffset: -1,
        attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
    }).addTo(map);
    L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
    markers = L.markerClusterGroup({
        iconCreateFunction: function (c) { const t = c.getChildCount(); let e = "marker-cluster-"; return e += t < 10 ? "small" : t < 100 ? "medium" : "large", L.divIcon({ html: `<div><span>${t}</span></div>`, className: "marker-cluster " + e, iconSize: new L.Point(40, 40) }) }
    });
    markers.on('clusterclick', handleClusterClick);
    map.addLayer(markers);
    // updateInfoPanelTextAndButtonState(); // Called by checkLoginState already
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

function openModal(mode){if(!authModal||!modalError||!authForm||!modalTitle||!modalSubmitBtn)return;modalError.textContent="",authForm.reset(),mode==="login"?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
async function handleAuthFormSubmit(e){e.preventDefault();if(!usernameInput||!passwordInput||!modalError)return;modalError.textContent="";const username=usernameInput.value,password=passwordInput.value,mode=authForm.dataset.mode,endpoint="login"===mode?"/api/users/login":"/api/users/register";try{const response=await fetch(`${API_URL}${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})}),data=await response.json();if(!response.ok)throw new Error(data.error||"An unknown error occurred.");mode==="register"?(modalError.textContent="Registration successful! Please log in.",authForm.reset(),openModal("login")):(localStorage.setItem("echoes_token",data.token),checkLoginState(),closeModal())}catch(error){modalError.textContent=error.message}}
function checkLoginState(){const token=localStorage.getItem("echoes_token");token?(userToken=token,loggedInUser=JSON.parse(atob(token.split(".")[1])).user.username,updateUIAfterLogin()):updateUIAfterLogout(); /* updateInfoPanelTextAndButtonState will be called by these */}
function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout()}
function updateUIAfterLogin(){if(!welcomeMessage||!loginBtn||!registerBtn||!logoutBtn)return;welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",updateInfoPanelTextAndButtonState()}
function updateUIAfterLogout(){if(!welcomeMessage||!loginBtn||!registerBtn||!logoutBtn)return;welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",updateInfoPanelTextAndButtonState()}
function handleClusterClick(a){if(!clusterEchoList||!clusterModal)return;const e=a.layer.getAllChildMarkers().map(e=>e.echoData);e.sort((e,o)=>new Date(o.created_at)-new Date(e.created_at)),clusterEchoList.innerHTML="",e.forEach(e=>{const o=document.createElement("div");o.className="echo-item";const t=e.username?`by ${e.username}`:`by an anonymous user`;o.innerHTML=`<p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${t}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`,clusterEchoList.appendChild(o)}),clusterModal.style.display="flex"}
async function fetchAllEchoes(position){if(!position||!position.lat||!position.lng||!markers||!echoMarkersMap)return;markers.clearLayers(),echoMarkersMap.clear(),updateStatus("Fetching nearby echoes...","info");try{const response=await fetch(`${API_URL}/echoes?lat=${position.lat}&lng=${position.lng}`);if(!response.ok)throw new Error(`Failed to fetch: ${response.statusText}`);const echoes=await response.json();renderEchoesOnMap(echoes),updateStatus(echoes.length>0?`${echoes.length} echo(s) found nearby.`:`No echoes found nearby. Be the first!`,echoes.length>0?"success":"info",3e3)}catch(error){console.error("Failed to fetch nearby echoes:",error),updateStatus("Could not fetch echoes.","error",3e3)}}
function renderEchoesOnMap(echoes){if(!markers||!echoMarkersMap)return;echoes.forEach(echo=>{if(echo.lat&&echo.lng){const ageInHours=(new Date-new Date(echo.last_played_at))/36e5,iconToUse=ageInHours<48?echoIconFresh:ageInHours<360?echoIconStable:echoIconFading,marker=L.marker([echo.lat,echo.lng],{icon:iconToUse});marker.echoData=echo,marker.bindPopup(createEchoPopup(echo)),echoMarkersMap.set(echo.id,marker),markers.addLayer(marker)}})}
function createEchoPopup(echo){const author=echo.username?`by ${echo.username}`:`by an anonymous user`;return`<h3>Echo Location</h3><p>Recorded on: ${new Date(echo.created_at).toLocaleDateString()} ${author}</p><audio controls onplay="keepEchoAlive(${echo.id})"src="${echo.audio_url}"></audio>`}
window.keepEchoAlive=async echoId=>{if(!echoMarkersMap)return;try{fetch(`${API_URL}/api/echoes/${echoId}/play`,{method:"POST"});const markerToUpdate=echoMarkersMap.get(echoId);markerToUpdate&&markerToUpdate.setIcon(echoIconFresh)}catch(error){console.error("Failed to send keep-alive ping:",error)}}
function handleFindMeClick(){updateStatus("Locating your position...","info"),isManualFind=!0,"geolocation"in navigator?navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError,{enableHighAccuracy:!0,timeout:1e4,maximumAge:0}):updateStatus("Geolocation is not supported.","error",3e3)}
function onLocationSuccess(position){currentUserPosition={lat:position.coords.latitude,lng:position.coords.longitude},map.flyTo([currentUserPosition.lat,currentUserPosition.lng],16),userMarker?userMarker.setLatLng([currentUserPosition.lat,currentUserPosition.lng]):userMarker=L.marker([currentUserPosition.lat,currentUserPosition.lng],{icon:userLocationIcon,interactive:!1,zIndexOffset:1e3}).addTo(map),radarCircle?radarCircle.setLatLng([currentUserPosition.lat,currentUserPosition.lng]):radarCircle=L.circle([currentUserPosition.lat,currentUserPosition.lng],{radius:RADAR_RADIUS_METERS,className:"js-radar-beacon"}).addTo(map),fetchAllEchoes(currentUserPosition);const latRounded=currentUserPosition.lat.toFixed(4),lngRounded=currentUserPosition.lng.toFixed(4);currentBucketKey=`sq_${latRounded}_${lngRounded}`,updateInfoPanelTextAndButtonState(),locationWatcherId||startLocationWatcher(),isManualFind=!1}
function onLocationError(error){updateStatus(`Error: ${error.message}`,"error",4e3),updateInfoPanelTextAndButtonState(),isManualFind=!1}
function startLocationWatcher(){locationWatcherId&&clearInterval(locationWatcherId),locationWatcherId=setInterval(()=>{isManualFind=!1,navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError,{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})},LOCATION_FETCH_INTERVAL_MS)}
function updateInfoPanelTextAndButtonState(){if(!infoPanelTitleEl||!recordBtn)return;currentUserPosition?(userToken?(infoPanelTitleEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1):(infoPanelTitleEl.textContent="Please Login or Register to leave an echo.",recordBtn.disabled=!0)):(infoPanelTitleEl.textContent="Click the 'Find Me' button on the map to start exploring.",recordBtn.disabled=!0)}
async function handleRecordClick(){if(!currentUserPosition)return void updateStatus("Please find your location first.","error",3e3);if(map.getZoom()<15&¤tUserPosition)map.flyTo([currentUserPosition.lat,currentUserPosition.lng],16);if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),clearTimeout(recordingTimer);else try{const stream=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(stream,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent=`Stop Recording (${MAX_RECORDING_SECONDS}s)`,recordBtn.classList.add("is-recording");let timeLeft=MAX_RECORDING_SECONDS;recordingTimer=setInterval(()=>{timeLeft--,recordBtn.textContent=`Stop Recording (${timeLeft}s)`,timeLeft<=0&&(mediaRecorder.stop(),clearTimeout(recordingTimer))},1e3)}catch(error){console.error("Mic error:",error),updateStatus("Could not access microphone.","error",3e3)}}
async function uploadAndSaveEcho(){recordBtn.textContent="Record Echo",recordBtn.classList.remove("is-recording"),recordBtn.disabled=!0,updateStatus("Processing...","info"),clearTimeout(recordingTimer);if(0===audioChunks.length)return updateStatus("Recording too short.","error",3e3),updateInfoPanelTextAndButtonState(),void(recordBtn.disabled=!userToken||!currentUserPosition);const audioBlob=new Blob(audioChunks,{type:"audio/webm"}),fileName=`echo_${currentBucketKey}_${Date.now()}.webm`;try{updateStatus("Preparing upload...","info");const presignedUrlRes=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName,fileType:audioBlob.type})});if(!presignedUrlRes.ok)throw new Error(`Presigned URL failed: ${await presignedUrlRes.text()}`);const{url:uploadUrl}=await presignedUrlRes.json();updateStatus("Uploading...","info");const uploadRes=await fetch(uploadUrl,{method:"PUT",body:audioBlob,headers:{"Content-Type":audioBlob.type}});if(!uploadRes.ok)throw new Error("Upload to R2 failed");const audio_url=`${R2_PUBLIC_URL_BASE}/${fileName}`;updateStatus("Saving...","info");const saveEchoRes=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!saveEchoRes.ok)throw new Error(`Save metadata failed: ${await saveEchoRes.text()}`);const newEcho=await saveEchoRes.json();updateStatus("Echo saved!","success",3e3),newEcho.username=loggedInUser,renderEchoesOnMap([newEcho])}catch(error){console.error("Full echo process failed:",error),updateStatus(`Error: ${error.message}`,"error",5e3)}finally{updateInfoPanelTextAndButtonState()}}

// initializeApp(); // Called from DOMContentLoaded listener