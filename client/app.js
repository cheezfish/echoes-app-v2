// client/app.js - FINAL, SIMPLIFIED VERSION

const API_URL = 'https://echoes-server.onrender.com'; // Your Render server URL

// --- DOM ELEMENTS ---
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const recordBtn = document.getElementById('record-btn');

// --- APP STATE ---
let map;
let mediaRecorder;
let audioChunks = [];
let currentUserPosition = { lat: 0, lng: 0 };
let currentBucketKey = ''; // This is our new, simple key

// === 1. INITIALIZE ===
function initializeApp() {
    map = L.map(mapContainer).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError);
    } else {
        w3wAddressEl.textContent = "Geolocation not supported.";
    }

    recordBtn.addEventListener('click', handleRecordClick);
    fetchAllEchoes();
}

// === 2. MAP & DATA FETCHING ===
async function fetchAllEchoes() {
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
            L.marker([echo.lat, echo.lng])
             .addTo(map)
             .bindPopup(createEchoPopup(echo));
        }
    });
}

function createEchoPopup(echo) {
    // We'll just show "Echo" since the grid key isn't user-friendly
    return `
        <h3>Echo Location</h3>
        <p>Recorded on: ${new Date(echo.created_at).toLocaleDateString()}</p>
        <audio controls src="${echo.audio_url}"></audio>
    `;
}

// === 3. GEOLOCATION & BUCKETING ===
function onLocationSuccess(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    
    map.setView([currentUserPosition.lat, currentUserPosition.lng], 16);
    L.marker([currentUserPosition.lat, currentUserPosition.lng]).addTo(map).bindPopup("You are here!").openPopup();

    // The new, simple "rounding" method to create a bucket key
    const latRounded = currentUserPosition.lat.toFixed(4);
    const lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    
    w3wAddressEl.textContent = "You are ready to record an echo.";
    recordBtn.disabled = false;
}

function onLocationError(error) {
    w3wAddressEl.textContent = `Error getting location: ${error.message}`;
}

// === 4. RECORDING & UPLOAD FLOW ===
async function handleRecordClick() {
    // This function remains the same
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

async function uploadAndSaveEcho() {
    if (audioChunks.length === 0) return;
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    // Use our simple bucket key for the filename
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
        const audio_url = uploadUrl.split('?')[0];

        const saveEchoRes = await fetch(`${API_URL}/echoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                w3w_address: currentBucketKey, // The server just sees this as a string key
                audio_url: audio_url,
                lat: currentUserPosition.lat,
                lng: currentUserPosition.lng
            })
        });
        if (!saveEchoRes.ok) throw new Error('Save metadata failed');
        
        const newEcho = await saveEchoRes.json();
        alert(`Success! Echo saved.`);
        w3wAddressEl.textContent = `You are ready to record an echo.`;
        renderEchoesOnMap([newEcho]);

    } catch (error) {
        console.error('Full echo process failed:', error);
        alert('An error occurred. Check console.');
        w3wAddressEl.textContent = `You are ready to record an echo.`;
    } finally {
        recordBtn.disabled = false;
    }
}

// --- KICK IT OFF ---
recordBtn.disabled = true;
initializeApp();