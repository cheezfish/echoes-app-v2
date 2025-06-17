// client/app.js - FINAL VERSION WITH METADATA HEADER FIX

const API_URL = 'https://echoes-server.onrender.com'; // Your Render server URL
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // PASTE YOUR PUBLIC R2 URL

// --- DOM ELEMENTS & APP STATE ---
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const recordBtn = document.getElementById('record-btn');
let map, mediaRecorder, audioChunks = [], currentUserPosition = { lat: 0, lng: 0 }, currentBucketKey = '';

// === 1. INITIALIZE ===
function initializeApp() {
    map = L.map(mapContainer).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
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
        if (!response.ok) throw new Error('Failed to fetch echoes from server');
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
    const latRounded = currentUserPosition.lat.toFixed(4);
    const lngRounded = currentUserPosition.lng.toFixed(4);
    currentBucketKey = `sq_${latRounded}_${lngRounded}`;
    w3wAddressEl.textContent = "You are ready to record an echo.";
    recordBtn.disabled = false;
}

function onLocationError(error) {
    w3wAddressEl.textContent = `Error getting location: ${error.message}`;
}

// === 4. RECORDING LOGIC ===
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
            audioChunks = [], mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = uploadAndSaveEcho, mediaRecorder.start();
            recordBtn.textContent = 'Stop Recording';
            recordBtn.style.backgroundColor = '#dc3545';
        } catch (error) {
            console.error('Mic error:', error), w3wAddressEl.textContent = 'Could not access microphone.';
        }
    }
}

// === 5. THE UPLOAD AND SAVE FLOW ===
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

        // Step C: Save the final metadata to our database
        const saveEchoRes = await fetch(`${API_URL}/echoes`, {
            method: 'POST',
            // === THIS IS THE FIX ===
            headers: { 'Content-Type': 'application/json' },
            // ======================
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
recordBtn.disabled = true;
initializeApp();