// client/app.js - WITH MARKER CLUSTERING & users

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // MAKE SURE THIS IS CORRECT

// === NEW: DOM ELEMENTS for AUTH ===
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const logoutBtn = document.getElementById('logout-btn');
const welcomeMessage = document.getElementById('welcome-message');
const authModal = document.getElementById('auth-modal');
const closeModalBtn = document.querySelector('.close-btn');
const authForm = document.getElementById('auth-form');
const modalTitle = document.getElementById('modal-title');
const modalSubmitBtn = document.getElementById('modal-submit-btn');
const modalError = document.getElementById('modal-error');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

// --- OLD DOM ELEMENTS ---
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const recordBtn = document.getElementById('record-btn');

// --- APP STATE ---
let map;
let mediaRecorder;
let audioChunks = [];
let currentUserPosition = { lat: 0, lng: 0 };
let currentBucketKey = '';
let markers;
let userToken = null; // <<< NEW: To store the user's JWT
let loggedInUser = null; // <<< NEW: To store username

// === 1. INITIALIZE ===
function initializeApp() {
    map = L.map(mapContainer).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    markers = L.markerClusterGroup();
    map.addLayer(markers);

    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError);
    } else {
        w3wAddressEl.textContent = "Geolocation not supported.";
    }

    // === NEW: Setup all event listeners ===
    setupEventListeners();

    // Check if a token exists in local storage from a previous session
    checkLoginState();
    
    // Fetch echoes on load
    fetchAllEchoes();
}

// === NEW: SETUP EVENT LISTENERS ===
function setupEventListeners() {
    loginBtn.addEventListener('click', () => openModal('login'));
    registerBtn.addEventListener('click', () => openModal('register'));
    logoutBtn.addEventListener('click', handleLogout);
    closeModalBtn.addEventListener('click', closeModal);
    authModal.addEventListener('click', (e) => {
        if (e.target === authModal) closeModal(); // Close if clicking on the overlay
    });
    authForm.addEventListener('submit', handleAuthFormSubmit);
    recordBtn.addEventListener('click', handleRecordClick);
}

// === NEW: AUTH MODAL LOGIC ===
function openModal(mode) {
    modalError.textContent = '';
    authForm.reset();
    if (mode === 'login') {
        modalTitle.textContent = 'Login';
        modalSubmitBtn.textContent = 'Login';
        authForm.dataset.mode = 'login';
    } else {
        modalTitle.textContent = 'Register';
        modalSubmitBtn.textContent = 'Register';
        authForm.dataset.mode = 'register';
    }
    authModal.style.display = 'flex';
}

function closeModal() {
    authModal.style.display = 'none';
}

async function handleAuthFormSubmit(e) {
    e.preventDefault();
    modalError.textContent = '';
    const username = usernameInput.value;
    const password = passwordInput.value;
    const mode = authForm.dataset.mode;
    const endpoint = mode === 'login' ? '/api/users/login' : '/api/users/register';

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'An unknown error occurred.');
        }

        if (mode === 'register') {
            alert('Registration successful! Please log in.');
            openModal('login');
        } else {
            // Login was successful, we have a token
            localStorage.setItem('echoes_token', data.token); // Store token
            checkLoginState(); // Update UI
            closeModal();
        }
    } catch (error) {
        modalError.textContent = error.message;
    }
}

// === NEW: AUTH STATE MANAGEMENT ===
function checkLoginState() {
    const token = localStorage.getItem('echoes_token');
    if (token) {
        userToken = token;
        // Decode token to get username (a simple way, doesn't verify signature)
        const payload = JSON.parse(atob(token.split('.')[1]));
        loggedInUser = payload.user.username;
        updateUIAfterLogin();
    } else {
        updateUIAfterLogout();
    }
}

function handleLogout() {
    localStorage.removeItem('echoes_token');
    userToken = null;
    loggedInUser = null;
    updateUIAfterLogout();
}

function updateUIAfterLogin() {
    welcomeMessage.textContent = `Welcome, ${loggedInUser}!`;
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    recordBtn.disabled = false; // Enable recording
}

function updateUIAfterLogout() {
    welcomeMessage.textContent = '';
    loginBtn.style.display = 'inline-block';
    registerBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    recordBtn.disabled = true; // Disable recording
}

// === OLD FUNCTIONS (Mostly unchanged) ===
async function fetchAllEchoes() { /* ... no change ... */ }
function renderEchoesOnMap(echoes) { /* ... no change ... */ }
function createEchoPopup(echo) { /* ... no change ... */ }
function onLocationSuccess(position) { /* ... no change ... */ }
function onLocationError(error) { /* ... no change ... */ }
async function handleRecordClick() { /* ... no change ... */ }
async function uploadAndSaveEcho() { /* ... no change ... */ }


// (Copying unchanged functions for completeness)
async function fetchAllEchoes(){markers.clearLayers();try{const e=await fetch(`${API_URL}/echoes`);if(!e.ok)throw new Error("Failed to fetch");const t=await e.json();renderEchoesOnMap(t)}catch(e){console.error("Failed to fetch echoes:",e)}}
function renderEchoesOnMap(e){e.forEach(e=>{if(e.lat&&e.lng){const t=L.marker([e.lat,e.lng]);t.bindPopup(createEchoPopup(e)),markers.addLayer(t)}})}
function createEchoPopup(e){return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()}</p><audio controls src="${e.audio_url}"></audio>`}
function onLocationSuccess(e){currentUserPosition.lat=e.coords.latitude,currentUserPosition.lng=e.coords.longitude,map.setView([currentUserPosition.lat,currentUserPosition.lng],16),L.marker([currentUserPosition.lat,currentUserPosition.lng]).addTo(map).bindPopup("You are here!").openPopup();const t=currentUserPosition.lat.toFixed(4),o=currentUserPosition.lng.toFixed(4);currentBucketKey=`sq_${t}_${o}`,w3wAddressEl.textContent="You are ready to record an echo.",userToken||(recordBtn.disabled=!0)}
function onLocationError(e){w3wAddressEl.textContent=`Error getting location: ${e.message}`}
async function handleRecordClick(){if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),recordBtn.textContent="Record Echo",recordBtn.style.backgroundColor="#007bff",recordBtn.disabled=!0,w3wAddressEl.textContent="Processing...";else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent="Stop Recording",recordBtn.style.backgroundColor="#dc3545"}catch(e){console.error("Mic error:",e),w3wAddressEl.textContent="Could not access microphone."}}
async function uploadAndSaveEcho(){if(0!==audioChunks.length){const e=new Blob(audioChunks,{type:"audio/webm"}),t=`echo_${currentBucketKey}_${Date.now()}.webm`;try{const o=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:t,fileType:e.type})});if(!o.ok)throw new Error(`Presigned URL failed: ${await o.text()}`);const{url:r}=await o.json(),a=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!a.ok)throw new Error("Upload to R2 failed");const n=`${R2_PUBLIC_URL_BASE}/${t}`,d=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:n,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!d.ok)throw new Error("Save metadata failed");const c=await d.json();alert("Success! Echo saved."),w3wAddressEl.textContent="You are ready to record an echo.",renderEchoesOnMap([c])}catch(e){console.error("Full echo process failed:",e),alert("An error occurred. Check console."),w3wAddressEl.textContent="You are ready to record an echo."}finally{recordBtn.disabled=!1}}else w3wAddressEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1}


// --- KICK IT OFF ---
initializeApp();