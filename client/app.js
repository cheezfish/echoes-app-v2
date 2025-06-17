// client/app.js - WITH MARKER CLUSTERING & users

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // MAKE SURE THIS IS CORRECT

// client/app.js - FINAL AUTHENTICATED VERSION

// client/app.js - POLISHED VERSION

// === ALL DOM ELEMENTS ===
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const statusMessageEl = document.getElementById('status-message'); // <<< NEW
const recordBtn = document.getElementById('record-btn');
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

// --- APP STATE ---
let map, mediaRecorder, audioChunks = [], currentUserPosition = { lat: 0, lng: 0 }, currentBucketKey = '', markers, userToken = null, loggedInUser = null;

// === NEW HELPER FUNCTION ===
function updateStatus(message, type = 'info', duration = 0) {
    statusMessageEl.textContent = message;
    statusMessageEl.className = type; // Applies .info, .success, or .error class

    if (duration > 0) {
        setTimeout(() => {
            // Only clear the message if it hasn't been replaced by a new one
            if (statusMessageEl.textContent === message) {
                statusMessageEl.textContent = '';
                statusMessageEl.className = '';
            }
        }, duration);
    }
}

// === 1. INITIALIZE & EVENT LISTENERS ===
function initializeApp() {
    map = L.map(mapContainer).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    markers = L.markerClusterGroup();
    map.addLayer(markers);
    setupEventListeners();
    checkLoginState();
    fetchAllEchoes();
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError);
    } else {
        w3wAddressEl.textContent = "Geolocation not supported.";
    }
}

function setupEventListeners() {
    loginBtn.addEventListener('click', () => openModal('login'));
    registerBtn.addEventListener('click', () => openModal('register'));
    logoutBtn.addEventListener('click', handleLogout);
    closeModalBtn.addEventListener('click', closeModal);
    authModal.addEventListener('click', (e) => { if (e.target === authModal) closeModal(); });
    authForm.addEventListener('submit', handleAuthFormSubmit);
    recordBtn.addEventListener('click', handleRecordClick);
}

// === 2. AUTHENTICATION (Now uses status messages) ===
function openModal(mode) { /* No changes */ }
function closeModal() { /* No changes */ }
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
        if (!response.ok) throw new Error(data.error || 'An unknown error occurred.');
        
        if (mode === 'register') {
            updateStatus('Registration successful! Please log in.', 'success', 4000);
            openModal('login');
        } else {
            localStorage.setItem('echoes_token', data.token);
            checkLoginState();
            closeModal();
            updateStatus('Logged in successfully!', 'success', 3000);
        }
    } catch (error) {
        modalError.textContent = error.message;
    }
}

function checkLoginState() { /* No changes */ }
function handleLogout() {
    localStorage.removeItem('echoes_token');
    userToken = null;
    loggedInUser = null;
    updateUIAfterLogout();
    updateStatus('You have been logged out.', 'info', 3000);
}
function updateUIAfterLogin() { /* No changes */ }
function updateUIAfterLogout() { /* No changes */ }

// === 3. MAP & DATA FETCHING ===
async function fetchAllEchoes() { /* No changes */ }
function renderEchoesOnMap(echoes) { /* No changes */ }
function createEchoPopup(echo) { /* No changes */ }

// === 4. GEOLOCATION & UX ===
function onLocationSuccess(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    map.setView([currentUserPosition.lat, currentUserPosition.lng], 16);
    L.marker([currentUserPosition.lat, currentUserPosition.lng]).addTo(map).bindPopup("You are here!").openPopup();
    const latRounded = currentUserPosition.lat.toFixed(4);
    const lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    
    // Updated UX logic
    if (userToken) {
        w3wAddressEl.textContent = "You are ready to record an echo.";
        recordBtn.disabled = false;
    } else {
        w3wAddressEl.textContent = "Please Login or Register to leave an echo.";
        recordBtn.disabled = true;
    }
}
function onLocationError(error) { /* No changes */ }

// === 5. RECORDING LOGIC (With better feedback) ===
async function handleRecordClick() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordBtn.textContent = 'Record Echo';
        recordBtn.classList.remove('is-recording'); // <<< Stop pulsing
        recordBtn.disabled = true;
        updateStatus('Processing echo...', 'info');
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = uploadAndSaveEcho;
            mediaRecorder.start();
            recordBtn.textContent = 'Stop Recording';

            recordBtn.classList.add('is-recording'); // <<< Start pulsing
            updateStatus('Recording...', 'info');
        } catch (error) {
            console.error('Mic error:', error);
            updateStatus('Could not access microphone.', 'error', 4000);
        }
    }
}

// === 6. UPLOAD & SAVE FLOW (Now with status updates) ===
async function uploadAndSaveEcho() {
    if (audioChunks.length === 0) {
        // Handle case where user stops recording immediately
        updateStatus('Recording was too short.', 'error', 3000);
        recordBtn.disabled = false;
        w3wAddressEl.textContent = "You are ready to record an echo."; // Reset main text
        return;
    }
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;

    try {
        updateStatus('Preparing upload...', 'info');
        const presignedUrlRes = await fetch(`${API_URL}/presigned-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName, fileType: audioBlob.type }) });
        if (!presignedUrlRes.ok) throw new Error(`Presigned URL failed: ${await presignedUrlRes.text()}`);
        const { url: uploadUrl } = await presignedUrlRes.json();
        
        updateStatus('Uploading...', 'info');
        const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: audioBlob, headers: { 'Content-Type': audioBlob.type } });
        if (!uploadRes.ok) throw new Error('Upload to R2 failed');

        const audio_url = `${R2_PUBLIC_URL_BASE}/${fileName}`;

        updateStatus('Saving...', 'info');
        const saveEchoRes = await fetch(`${API_URL}/echoes`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` }, body: JSON.stringify({ w3w_address: currentBucketKey, audio_url, lat: currentUserPosition.lat, lng: currentUserPosition.lng }) });
        if (!saveEchoRes.ok) throw new Error('Save metadata failed');
        
        const newEcho = await saveEchoRes.json();
        updateStatus('Success! Your echo is on the map.', 'success', 4000);
        w3wAddressEl.textContent = `You are ready to record an echo.`;
        newEcho.username = loggedInUser; 
        renderEchoesOnMap([newEcho]);

    } catch (error) {
        console.error('Full echo process failed:', error);
        updateStatus('Something went wrong. Please try again.', 'error', 4000);
        w3wAddressEl.textContent = `You are ready to record an echo.`;
    } finally {
        recordBtn.disabled = false;
    }
}


// --- KICK EVERYTHING OFF ---
initializeApp();

// (Copying unchanged functions here for completeness)
function openModal(e){modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
function closeModal(){authModal.style.display="none"}
function checkLoginState(){const e=localStorage.getItem("echoes_token");e?(userToken=e,loggedInUser=JSON.parse(atob(e.split(".")[1])).user.username,updateUIAfterLogin()):updateUIAfterLogout()}
function updateUIAfterLogin(){welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",currentBucketKey&& (recordBtn.disabled = false)}
function updateUIAfterLogout(){welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",recordBtn.disabled=!0, w3wAddressEl.textContent = "Please Login or Register to leave an echo.";}
async function fetchAllEchoes(){markers.clearLayers();try{const e=await fetch(`${API_URL}/echoes`);if(!e.ok)throw new Error("Failed to fetch");const t=await e.json();renderEchoesOnMap(t)}catch(e){console.error("Failed to fetch echoes:",e)}}
function renderEchoesOnMap(e){e.forEach(e=>{if(e.lat&&e.lng){const t=L.marker([e.lat,e.lng]);t.bindPopup(createEchoPopup(e)),markers.addLayer(t)}})}
function createEchoPopup(e){const t=e.username?`by ${e.username}`:"by an anonymous user";return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()} ${t}</p><audio controls src="${e.audio_url}"></audio>`}
function onLocationError(e){w3wAddressEl.textContent=`Error getting location: ${e.message}`}