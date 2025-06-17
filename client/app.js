// client/app.js - WITH CUSTOM MARKER ICONS

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // MAKE SURE THIS IS CORRECT

// === NEW: DEFINE OUR CUSTOM ICONS ===
const userLocationIcon = L.icon({
    iconUrl: 'https://api.iconify.design/material-symbols:my-location.svg?color=%23007bff', // A blue crosshair icon
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
});

const echoIcon = L.icon({
    iconUrl: 'https://api.iconify.design/material-symbols:graphic-eq.svg?color=%23dc3545', // A red soundwave icon
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
});
// =====================================

// --- DOM ELEMENTS & APP STATE (No changes) ---
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const recordBtn = document.getElementById('record-btn');
// ... (rest of the DOM elements)
let map, mediaRecorder, audioChunks = [], currentUserPosition = { lat: 0, lng: 0 }, currentBucketKey = '', markers, userToken = null, loggedInUser = null;

// === INITIALIZE, AUTH, RECORDING, etc. (No changes in these functions) ===
// ...

// === MAP & DATA FETCHING (Small change here) ===
function renderEchoesOnMap(echoes) {
    echoes.forEach(echo => {
        if (echo.lat && echo.lng) {
            // <<< USE THE CUSTOM ECHO ICON HERE >>>
            const marker = L.marker([echo.lat, echo.lng], { icon: echoIcon });
            marker.bindPopup(createEchoPopup(echo));
            markers.addLayer(marker);
        }
    });
}

// === GEOLOCATION (Small change here) ===
function onLocationSuccess(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    
    map.setView([currentUserPosition.lat, currentUserPosition.lng], 16);

    // <<< USE THE CUSTOM USER ICON HERE >>>
    L.marker([currentUserPosition.lat, currentUserPosition.lng], { icon: userLocationIcon })
     .addTo(map)
     .bindPopup("You are here!");
    
    const latRounded = currentUserPosition.lat.toFixed(4);
    const lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    
    if (userToken) {
        w3wAddressEl.textContent = "You are ready to record an echo.";
        recordBtn.disabled = false;
    } else {
        w3wAddressEl.textContent = "Please Login or Register to leave an echo.";
        recordBtn.disabled = true;
    }
}

// ... (Rest of the functions are unchanged, but I'll provide the full file below for safety)

// === FULL, UNCHANGED FUNCTIONS FOR COMPLETENESS ===
const loginBtn=document.getElementById("login-btn"),registerBtn=document.getElementById("register-btn"),logoutBtn=document.getElementById("logout-btn"),welcomeMessage=document.getElementById("welcome-message"),authModal=document.getElementById("auth-modal"),closeModalBtn=document.querySelector(".close-btn"),authForm=document.getElementById("auth-form"),modalTitle=document.getElementById("modal-title"),modalSubmitBtn=document.getElementById("modal-submit-btn"),modalError=document.getElementById("modal-error"),usernameInput=document.getElementById("username"),passwordInput=document.getElementById("password");function initializeApp(){map=L.map(mapContainer).setView([51.505,-.09],13),L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map),markers=L.markerClusterGroup(),map.addLayer(markers),setupEventListeners(),checkLoginState(),fetchAllEchoes(),"geolocation"in navigator?navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError):w3wAddressEl.textContent="Geolocation not supported."}function setupEventListeners(){loginBtn.addEventListener("click",()=>openModal("login")),registerBtn.addEventListener("click",()=>openModal("register")),logoutBtn.addEventListener("click",handleLogout),closeModalBtn.addEventListener("click",closeModal),authModal.addEventListener("click",e=>{e.target===authModal&&closeModal()}),authForm.addEventListener("submit",handleAuthFormSubmit),recordBtn.addEventListener("click",handleRecordClick)}function openModal(e){modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}function closeModal(){authModal.style.display="none"}async function handleAuthFormSubmit(e){e.preventDefault(),modalError.textContent="";const t=usernameInput.value,o=passwordInput.value,n=authForm.dataset.mode,s="login"===n?"/api/users/login":"/api/users/register";try{const c=await fetch(`${API_URL}${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:t,password:o})}),d=await c.json();if(!c.ok)throw new Error(d.error||"An unknown error occurred.");"register"===n?(alert("Registration successful! Please log in."),openModal("login")):(localStorage.setItem("echoes_token",d.token),checkLoginState(),closeModal())}catch(c){modalError.textContent=c.message}}function checkLoginState(){const e=localStorage.getItem("echoes_token");e?(userToken=e,loggedInUser=JSON.parse(atob(e.split(".")[1])).user.username,updateUIAfterLogin()):updateUIAfterLogout()}function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout()}function updateUIAfterLogin(){welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",currentBucketKey&& (recordBtn.disabled = false)}function updateUIAfterLogout(){welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",recordBtn.disabled=!0, w3wAddressEl.textContent = "Please Login or Register to leave an echo.";}async function fetchAllEchoes(){markers.clearLayers();try{const e=await fetch(`${API_URL}/echoes`);if(!e.ok)throw new Error("Failed to fetch");const t=await e.json();renderEchoesOnMap(t)}catch(e){console.error("Failed to fetch echoes:",e)}}function createEchoPopup(e){const t=e.username?`by ${e.username}`:"by an anonymous user";return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${t}</p><audio controls src="${e.audio_url}"></audio>`}function onLocationError(e){w3wAddressEl.textContent=`Error getting location: ${e.message}`}async function handleRecordClick(){if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),recordBtn.textContent="Record Echo",recordBtn.style.backgroundColor="#007bff",recordBtn.disabled=!0,w3wAddressEl.textContent="Processing...";else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent="Stop Recording",recordBtn.style.backgroundColor="#dc3545"}catch(e){console.error("Mic error:",e),w3wAddressEl.textContent="Could not access microphone."}}async function uploadAndSaveEcho(){if(0!==audioChunks.length){const e=new Blob(audioChunks,{type:"audio/webm"}),t=`echo_${currentBucketKey}_${Date.now()}.webm`;try{const o=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:t,fileType:e.type})});if(!o.ok)throw new Error(`Presigned URL failed: ${await o.text()}`);const{url:r}=await o.json(),n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${t}`,d=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!d.ok)throw new Error("Save metadata failed");const s=await d.json();alert("Success! Echo saved."),w3wAddressEl.textContent="You are ready to record an echo.",s.username=loggedInUser,renderEchoesOnMap([s])}catch(e){console.error("Full echo process failed:",e),alert("An error occurred. Check console."),w3wAddressEl.textContent="You are ready to record an echo."}finally{recordBtn.disabled=!1}}else w3wAddressEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1}
initializeApp();