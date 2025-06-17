// client/app.js - WITH MARKER CLUSTERING & users

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // MAKE SURE THIS IS CORRECT

// client/app.js - FINAL AUTHENTICATED VERSION

// DOM Elements
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
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

// App State
let map, mediaRecorder, audioChunks = [], currentUserPosition = { lat: 0, lng: 0 }, currentBucketKey = '', markers, userToken = null, loggedInUser = null;

// === 1. INITIALIZE & EVENT LISTENERS ===
function initializeApp() {
    map = L.map(mapContainer).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
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

// === 2. AUTHENTICATION (Modal, State, Forms) ===
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
            localStorage.setItem('echoes_token', data.token);
            checkLoginState();
            closeModal();
        }
    } catch (error) {
        modalError.textContent = error.message;
    }
}

function checkLoginState() {
    const token = localStorage.getItem('echoes_token');
    if (token) {
        userToken = token;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            loggedInUser = payload.user.username;
            updateUIAfterLogin();
        } catch (error) {
            console.error("Failed to decode token", error);
            handleLogout();
        }
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
    if (currentBucketKey) recordBtn.disabled = false;
}

function updateUIAfterLogout() {
    welcomeMessage.textContent = '';
    loginBtn.style.display = 'inline-block';
    registerBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    recordBtn.disabled = true;
}

// === 3. MAP & DATA FETCHING ===
async function fetchAllEchoes() {
    markers.clearLayers();
    try {
        const response = await fetch(`${API_URL}/echoes`);
        if (!response.ok) throw new Error('Failed to fetch');
        const echoes = await response.json();
        renderEchoesOnMap(echoes);
    } catch (error) {
        console.error("Failed to fetch echoes:", error);
    }
}

function renderEchoesOnMap(echoes) {
    echoes.forEach(echo => {
        if (echo.lat && echo.lng) {
            const marker = L.marker([echo.lat, echo.lng]);
            marker.bindPopup(createEchoPopup(echo));
            markers.addLayer(marker);
        }
    });
}

function createEchoPopup(echo) {
    const author = echo.username ? `by ${echo.username}` : 'by an anonymous user';
    return `
        <h3>Echo Location</h3>
        <p>Recorded on: ${new Date(echo.created_at).toLocaleDateString()} ${author}</p>
        <audio controls src="${echo.audio_url}"></audio>
    `;
}

// === 4. GEOLOCATION & RECORDING LOGIC ===
function onLocationSuccess(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    map.setView([currentUserPosition.lat, currentUserPosition.lng], 16);
    L.marker([currentUserPosition.lat, currentUserPosition.lng]).addTo(map).bindPopup("You are here!").openPopup();
    const latRounded = currentUserPosition.lat.toFixed(4);
    const lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    w3wAddressEl.textContent = "You are ready to record an echo.";
    if (userToken) recordBtn.disabled = false;
}

function onLocationError(error) {
    w3wAddressEl.textContent = `Error getting location: ${error.message}`;
}

async function handleRecordClick() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordBtn.textContent = 'Record Echo';
        recordBtn.style.backgroundColor = '#007bff';
        recordBtn.disabled = true;
        w3wAddressEl.textContent = 'Processing...';
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = uploadAndSaveEcho;
            mediaRecorder.start();
            recordBtn.textContent = 'Stop Recording';
            recordBtn.style.backgroundColor = '#dc3545';
        } catch (error) {
            console.error('Mic error:', error);
            w3wAddressEl.textContent = 'Could not access microphone.';
        }
    }
}

// === 5. UPLOAD & SAVE FLOW ===
async function uploadAndSaveEcho() {
    if (audioChunks.length === 0) {
        w3wAddressEl.textContent = 'You are ready to record an echo.';
        recordBtn.disabled = false;
        return;
    }
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const fileName = `echo_${currentBucketKey}_${Date.now()}.webm`;
    try {
        const presignedUrlRes = await fetch(`${API_URL}/presigned-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, fileType: audioBlob.type })
        });
        if (!presignedUrlRes.ok) throw new Error(`Presigned URL failed: ${await presignedUrlRes.text()}`);
        const { url: uploadUrl } = await presignedUrlRes.json();

        const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: audioBlob, headers: { 'Content-Type': audioBlob.type } });
        if (!uploadRes.ok) throw new Error('Upload to R2 failed');

        const audio_url = `${R2_PUBLIC_URL_BASE}/${fileName}`;

        const saveEchoRes = await fetch(`${API_URL}/echoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                w3w_address: currentBucketKey,
                audio_url: audio_url,
                lat: currentUserPosition.lat,
                lng: currentUserPosition.lng
            })
        });
        if (!saveEchoRes.ok) throw new Error('Save metadata failed');
        
        const newEcho = await saveEchoRes.json();
        alert(`Success! Echo saved.`);
        w3wAddressEl.textContent = `You are ready to record an echo.`;
        newEcho.username = loggedInUser; 
        renderEchoesOnMap([newEcho]);

    } catch (error) {
        console.error('Full echo process failed:', error);
        alert('An error occurred. Check console.');
        w3wAddressEl.textContent = `You are ready to record an echo.`;
    } finally {
        recordBtn.disabled = false;
    }
}

// --- KICK EVERYTHING OFF ---
initializeApp();