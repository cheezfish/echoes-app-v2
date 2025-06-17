// client/app.js - FINAL ROBUST VERSION (FOR REAL THIS TIME)

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

// === CONSTANTS ===
const MAX_RECORDING_SECONDS = 60;
const RADAR_RADIUS_METERS = 100;

// === ICONS ===
const userLocationIcon = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff", iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
const echoIconFresh = L.icon({ iconUrl: "https://api.iconify.design/mdi:fire.svg?color=%23ffc107", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconStable = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%23dc3545", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
const echoIconFading = L.icon({ iconUrl: "https://api.iconify.design/material-symbols:graphic-eq.svg?color=%236c757d", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });

// --- DOM ELEMENTS ---
const mapContainer = document.getElementById("map"), w3wAddressEl = document.getElementById("w3w-address"), recordBtn = document.getElementById("record-btn"), loginBtn = document.getElementById("login-btn"), registerBtn = document.getElementById("register-btn"), logoutBtn = document.getElementById("logout-btn"), welcomeMessage = document.getElementById("welcome-message"), authModal = document.getElementById("auth-modal"), closeModalBtn = document.querySelector("#auth-modal .close-btn"), authForm = document.getElementById("auth-form"), modalTitle = document.getElementById("modal-title"), modalSubmitBtn = document.getElementById("modal-submit-btn"), modalError = document.getElementById("modal-error"), usernameInput = document.getElementById("username"), passwordInput = document.getElementById("password"), refreshRadarBtn = document.getElementById("refresh-radar-btn"), clusterModal = document.getElementById("cluster-modal"), closeClusterModalBtn = document.querySelector("#cluster-modal .close-btn"), clusterEchoList = document.getElementById("cluster-echo-list"), findMeBtn = document.getElementById("find-me-btn");

// --- APP STATE ---
let map, mediaRecorder, audioChunks = [], currentUserPosition = { lat: 0, lng: 0 }, currentBucketKey = "", markers, userToken = null, loggedInUser = null, echoMarkersMap = new Map, userMarker, radarCircle;
let recordingTimer;
let locationWatcherId = null; // To keep track of our setInterval

// === 1. INITIALIZE APP ===
function initializeApp() {
    setupEventListeners();
    checkLoginState();

    map = L.map(mapContainer, { zoomControl: false }).setView([20, 0], 2); // Start with a world view
    L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        attribution: '© <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markers = L.markerClusterGroup({
        iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();
            let className = 'marker-cluster-';
            if (count < 10) className += 'small';
            else if (count < 100) className += 'medium';
            else className += 'large';
            return L.divIcon({ html: `<div><span>${count}</span></div>`, className: 'marker-cluster ' + className, iconSize: new L.Point(40, 40) });
        }
    });
    markers.on('clusterclick', handleClusterClick);
    map.addLayer(markers);

    w3wAddressEl.textContent = "Click the 'Find Me' button on the map to start exploring.";
    recordBtn.disabled = true; // Always start disabled
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
    // Hide the unused refresh radar button for now
    if (refreshRadarBtn) refreshRadarBtn.style.display = 'none';
}

// === 2. AUTHENTICATION (Unchanged) ===
function openModal(e){modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
async function handleAuthFormSubmit(e){e.preventDefault(),modalError.textContent="";const o=usernameInput.value,t=passwordInput.value,n=authForm.dataset.mode,s="login"===n?"/api/users/login":"/api/users/register";try{const c=await fetch(`${API_URL}${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:o,password:t})}),d=await c.json();if(!c.ok)throw new Error(d.error||"An unknown error occurred.");"register"===n?(modalError.textContent="Registration successful! Please log in.",authForm.reset(),openModal("login")):(localStorage.setItem("echoes_token",d.token),checkLoginState(),closeModal())}catch(c){modalError.textContent=c.message}}
function checkLoginState(){const e=localStorage.getItem("echoes_token");if(e){userToken=e;try{const o=JSON.parse(atob(e.split(".")[1]));loggedInUser=o.user.username,updateUIAfterLogin()}catch(o){console.error("Failed to decode token",o),handleLogout()}}else updateUIAfterLogout()}
function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout()}
function updateUIAfterLogin(){welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",currentBucketKey&& (recordBtn.disabled = false)}
function updateUIAfterLogout(){welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",recordBtn.disabled=!0, w3wAddressEl.textContent = "Click the 'Find Me' button to start exploring.";}


// === 3. CLUSTER & MAP RENDERING (Unchanged) ===
function handleClusterClick(a){const e=a.layer.getAllChildMarkers().map(e=>e.echoData);e.sort((e,o)=>new Date(o.created_at)-new Date(e.created_at)),clusterEchoList.innerHTML="",e.forEach(e=>{const o=document.createElement("div");o.className="echo-item";const t=e.username?`by ${e.username}`:"by an anonymous user";o.innerHTML=`<p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${t}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`,clusterEchoList.appendChild(o)}),clusterModal.style.display="flex"}
async function fetchAllEchoes(e){markers.clearLayers(),echoMarkersMap.clear();try{const o=await fetch(`${API_URL}/echoes?lat=${e.lat}&lng=${e.lng}`);if(!o.ok)throw new Error("Failed to fetch");const t=await o.json();renderEchoesOnMap(t)}catch(o){console.error("Failed to fetch nearby echoes:",o)}}
function renderEchoesOnMap(e){e.forEach(e=>{if(e.lat&&e.lng){const o=new Date-new Date(e.last_played_at);let t=o<1728e5?echoIconFresh:o<1296e6?echoIconStable:echoIconFading;const n=L.marker([e.lat,e.lng],{icon:t});n.echoData=e,n.bindPopup(createEchoPopup(e)),echoMarkersMap.set(e.id,n),markers.addLayer(n)}})}
function createEchoPopup(e){const o=e.username?`by ${e.username}`:"by an anonymous user";return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${o}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`}
window.keepEchoAlive=async e=>{try{fetch(`${API_URL}/api/echoes/${e}/play`,{method:"POST"});const o=echoMarkersMap.get(e);o&&o.setIcon(echoIconFresh)}catch(o){console.error("Failed to send keep-alive ping:",o)}}


// === 4. GEOLOCATION (User-Initiated and Robust) ===
function handleFindMeClick() {
    w3wAddressEl.textContent = "Locating your position...";
    const geoOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError, geoOptions);
}

function onLocationSuccess(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    map.flyTo([currentUserPosition.lat, currentUserPosition.lng], 16);
    
    if (!userMarker) {
        radarCircle = L.circle([currentUserPosition.lat, currentUserPosition.lng], { radius: RADAR_RADIUS_METERS, className: 'js-radar-beacon' }).addTo(map);
        userMarker = L.marker([currentUserPosition.lat, currentUserPosition.lng], { icon: userLocationIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else {
        const newLatLng = [currentUserPosition.lat, currentUserPosition.lng];
        radarCircle.setLatLng(newLatLng);
        userMarker.setLatLng(newLatLng);
    }
    
    fetchAllEchoes(currentUserPosition);
    startLocationWatcher(); // Start watching only after the first successful find
    
    const latRounded = currentUserPosition.lat.toFixed(4), lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    if (userToken) {
        w3wAddressEl.textContent = "You are ready to record an echo.";
        recordBtn.disabled = false;
    } else {
        w3wAddressEl.textContent = "Please Login or Register to leave an echo.";
    }
}

function onLocationError(error) { w3wAddressEl.textContent = `Error: ${error.message}`; }

function startLocationWatcher() {
    if (locationWatcherId) clearInterval(locationWatcherId); // Clear any previous watcher
    locationWatcherId = setInterval(handleFindMeClick, 30000); // Re-use the find me logic
}

// === 5. RECORDING & UPLOAD FLOW (Unchanged) ===
async function handleRecordClick(){if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),clearTimeout(recordingTimer);else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent=`Stop Recording (${MAX_RECORDING_SECONDS}s)`,recordBtn.classList.add("is-recording");let o=MAX_RECORDING_SECONDS;recordingTimer=setInterval(()=>{o--,recordBtn.textContent=`Stop Recording (${o}s)`,o<=0&&(mediaRecorder.stop(),clearTimeout(recordingTimer))},1e3)}catch(e){console.error("Mic error:",e),w3wAddressEl.textContent="Could not access microphone."}}
async function uploadAndSaveEcho(){recordBtn.textContent="Record Echo",recordBtn.classList.remove("is-recording"),recordBtn.disabled=!0,w3wAddressEl.textContent="Processing...",clearTimeout(recordingTimer);if(0===audioChunks.length)return w3wAddressEl.textContent="You are ready to record an echo.",void(recordBtn.disabled=!1);const e=new Blob(audioChunks,{type:"audio/webm"}),o=`echo_${currentBucketKey}_${Date.now()}.webm`;try{const t=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:o,fileType:e.type})});if(!t.ok)throw new Error(`Presigned URL failed: ${await t.text()}`);const{url:r}=await t.json(),n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${o}`,s=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!s.ok)throw new Error("Save metadata failed");const d=await s.json();w3wAddressEl.textContent="You are ready to record an echo.",d.username=loggedInUser,renderEchoesOnMap([d])}catch(t){console.error("Full echo process failed:",t)}finally{recordBtn.disabled=!1}}

// --- KICK EVERYTHING OFF ---
initializeApp();