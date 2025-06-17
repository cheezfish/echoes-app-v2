// client/app.js - WITH GEOGRAPHICALLY-ACCURATE RADAR

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';

// === ICONS (No changes) ===
const userLocationIcon=L.icon({iconUrl:"https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff",iconSize:[32,32],iconAnchor:[16,32],popupAnchor:[0,-32]});
const echoIconFresh=L.icon({iconUrl:"https://api.iconify.design/mdi:fire.svg?color=%23ffc107",iconSize:[32,32],iconAnchor:[16,16],popupAnchor:[0,-16]}),echoIconStable=L.icon({iconUrl:"https://api.iconify.design/material-symbols:graphic-eq.svg?color=%23dc3545",iconSize:[32,32],iconAnchor:[16,16],popupAnchor:[0,-16]}),echoIconFading=L.icon({iconUrl:"https://api.iconify.design/material-symbols:graphic-eq.svg?color=%236c757d",iconSize:[32,32],iconAnchor:[16,16],popupAnchor:[0,-16]});

// --- DOM ELEMENTS & APP STATE (No more radarDivIcon) ---
const mapContainer=document.getElementById("map"),w3wAddressEl=document.getElementById("w3w-address"),recordBtn=document.getElementById("record-btn"),loginBtn=document.getElementById("login-btn"),registerBtn=document.getElementById("register-btn"),logoutBtn=document.getElementById("logout-btn"),welcomeMessage=document.getElementById("welcome-message"),authModal=document.getElementById("auth-modal"),closeModalBtn=document.querySelector(".close-btn"),authForm=document.getElementById("auth-form"),modalTitle=document.getElementById("modal-title"),modalSubmitBtn=document.getElementById("modal-submit-btn"),modalError=document.getElementById("modal-error"),usernameInput=document.getElementById("username"),passwordInput=document.getElementById("password");
let map,mediaRecorder,audioChunks=[],currentUserPosition={lat:0,lng:0},currentBucketKey="",markers,userToken=null,loggedInUser=null,echoMarkersMap=new Map;
let userMarker, radarCircle; // <<< Changed radarMarker to radarCircle

// === 1. INITIALIZE & EVENT LISTENERS ===
function initializeApp(){setupEventListeners(),checkLoginState(),map=L.map(mapContainer,{zoomControl:false}).setView([51.505,-.09],13),L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map),markers=L.markerClusterGroup(),map.addLayer(markers),"geolocation"in navigator?navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError):w3wAddressEl.textContent="Geolocation not supported."}
function setupEventListeners(){loginBtn.addEventListener("click",()=>openModal("login")),registerBtn.addEventListener("click",()=>openModal("register")),logoutBtn.addEventListener("click",handleLogout),closeModalBtn.addEventListener("click",closeModal),authModal.addEventListener("click",e=>{e.target===authModal&&closeModal()}),authForm.addEventListener("submit",handleAuthFormSubmit),recordBtn.addEventListener("click",handleRecordClick)}

// === 2. AUTHENTICATION (No changes) ===
function openModal(e){modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
function closeModal(){authModal.style.display="none"}
async function handleAuthFormSubmit(e){e.preventDefault(),modalError.textContent="";const o=usernameInput.value,t=passwordInput.value,n=authForm.dataset.mode,s="login"===n?"/api/users/login":"/api/users/register";try{const c=await fetch(`${API_URL}${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:o,password:t})}),d=await c.json();if(!c.ok)throw new Error(d.error||"An unknown error occurred.");"register"===n?(modalError.textContent="Registration successful! Please log in.",authForm.reset(),openModal("login")):(localStorage.setItem("echoes_token",d.token),checkLoginState(),closeModal())}catch(c){modalError.textContent=c.message}}
function checkLoginState(){const e=localStorage.getItem("echoes_token");if(e){userToken=e;try{const o=JSON.parse(atob(e.split(".")[1]));loggedInUser=o.user.username,updateUIAfterLogin()}catch(o){console.error("Failed to decode token",o),handleLogout()}}else updateUIAfterLogout()}
function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout()}
function updateUIAfterLogin(){welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",currentBucketKey&& (recordBtn.disabled = false)}
function updateUIAfterLogout(){welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",recordBtn.disabled=!0, w3wAddressEl.textContent = "Please Login or Register to leave an echo.";}

// === 3. MAP & DATA FETCHING (No changes) ===
async function fetchAllEchoes(e){markers.clearLayers(),echoMarkersMap.clear();try{const o=await fetch(`${API_URL}/echoes?lat=${e.lat}&lng=${e.lng}`);if(!o.ok)throw new Error("Failed to fetch");const t=await o.json();renderEchoesOnMap(t)}catch(o){console.error("Failed to fetch nearby echoes:",o)}}
function renderEchoesOnMap(e){e.forEach(e=>{if(e.lat&&e.lng){const o=new Date-new Date(e.last_played_at);let t=o<1728e5?echoIconFresh:o<1296e6?echoIconStable:echoIconFading;const n=L.marker([e.lat,e.lng],{icon:t});n.bindPopup(createEchoPopup(e)),echoMarkersMap.set(e.id,n),markers.addLayer(n)}})}
function createEchoPopup(e){const o=e.username?`by ${e.username}`:"by an anonymous user";return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${o}</p><audio controls onplay="keepEchoAlive(${e.id})" src="${e.audio_url}"></audio>`}
window.keepEchoAlive=async e=>{try{fetch(`${API_URL}/api/echoes/${e}/play`,{method:"POST"});const o=echoMarkersMap.get(e);o&&o.setIcon(echoIconFresh)}catch(o){console.error("Failed to send keep-alive ping:",o)}}

// === 4. GEOLOCATION & LIVE UPDATES (HEAVILY UPGRADED FOR ACCURATE RADAR) ===
function onLocationSuccess(position) {
    updateCurrentUserPosition(position);
    startLocationWatcher();
}

function onLocationError(error) {
    w3wAddressEl.textContent = `Error getting location: ${error.message}`;
}

function updateCurrentUserPosition(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    map.setView([currentUserPosition.lat, currentUserPosition.lng], 16);
    
    // <<< THE NEW LOGIC FOR RADAR AND USER MARKER >>>
    if (!userMarker) {
        // First time: Create the layers
        radarCircle = L.circle([currentUserPosition.lat, currentUserPosition.lng], {
            radius: 0, // Start at 0, JS will animate it
            className: 'js-radar-beacon'
        }).addTo(map);

        userMarker = L.marker([currentUserPosition.lat, currentUserPosition.lng], { 
            icon: userLocationIcon, 
            interactive: false,
            zIndexOffset: 1000 // Ensure user icon is on top of the radar
        }).addTo(map);

        // Start the JS-based animation loop
        animateRadar();
    } else {
        // Subsequent times: Just move the layers
        const newLatLng = [currentUserPosition.lat, currentUserPosition.lng];
        radarCircle.setLatLng(newLatLng);
        userMarker.setLatLng(newLatLng);
    }
    
    fetchAllEchoes(currentUserPosition);

    const latRounded = currentUserPosition.lat.toFixed(4);
    const lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    if (userToken) {
        w3wAddressEl.textContent = "You are ready to record an echo.";
        recordBtn.disabled = false;
    } else {
        w3wAddressEl.textContent = "Please Login or Register to leave an echo.";
    }
}

// <<< NEW: The JavaScript Animation Loop for the Radar >>>
function animateRadar() {
    let radius = 0;
    let opacity = 0.5;
    const maxRadius = 100; // The real 100m radius
    const animationSpeed = 2; // Higher is faster

    setInterval(() => {
        // Grow the radius
        radius += animationSpeed;
        
        // Calculate opacity to fade out as it grows
        opacity = 0.5 * (1 - (radius / maxRadius));

        // Apply the new radius and style
        radarCircle.setRadius(radius);
        radarCircle.setStyle({ fillOpacity: opacity, strokeOpacity: opacity });
        
        // Reset the animation when it gets too big
        if (radius > maxRadius) {
            radius = 0;
        }
    }, 50); // Run this animation logic 20 times per second
}

function startLocationWatcher() {
    setInterval(() => {
        navigator.geolocation.getCurrentPosition(updateCurrentUserPosition, null, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    }, 60000);
}

// === 5. RECORDING & UPLOAD FLOW (No changes) ===
async function handleRecordClick(){if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),recordBtn.textContent="Record Echo",recordBtn.style.backgroundColor="#007bff",recordBtn.disabled=!0,w3wAddressEl.textContent="Processing...";else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent="Stop Recording",recordBtn.style.backgroundColor="#dc3545"}catch(e){console.error("Mic error:",e),w3wAddressEl.textContent="Could not access microphone."}}
async function uploadAndSaveEcho(){if(0===audioChunks.length)return w3wAddressEl.textContent="You are ready to record an echo.",void(recordBtn.disabled=!1);const e=new Blob(audioChunks,{type:"audio/webm"}),o=`echo_${currentBucketKey}_${Date.now()}.webm`;try{const t=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:o,fileType:e.type})});if(!t.ok)throw new Error(`Presigned URL failed: ${await t.text()}`);const{url:r}=await t.json(),n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${o}`,s=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!s.ok)throw new Error("Save metadata failed");const d=await s.json();d.username=loggedInUser,renderEchoesOnMap([d])}catch(t){console.error("Full echo process failed:",t)}finally{w3wAddressEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1}}

// --- KICK EVERYTHING OFF ---
initializeApp();