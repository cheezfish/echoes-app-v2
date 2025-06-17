// client/app.js - Using Plus Codes

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
let currentW3WAddress = ''; // We'll keep the variable name for simplicity

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
    fetchAllEchoes(); // Fetch existing echoes on load
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
        // Only render if it has valid coordinates
        if (echo.lat && echo.lng) {
            L.marker([echo.lat, echo.lng])
             .addTo(map)
             .bindPopup(createEchoPopup(echo));
        }
    });
}

function createEchoPopup(echo) {
    // Use the w3w_address which now stores the Plus Code
    return `
        <h3>+${echo.w3w_address}</h3>
        <p>Recorded on: ${new Date(echo.created_at).toLocaleDateString()}</p>
        <audio controls src="${echo.audio_url}"></audio>
    `;
}

// === 3. GEOLOCATION & PLUS CODES ===
async function onLocationSuccess(position) {
    currentUserPosition.lat = position.coords.latitude;
    currentUserPosition.lng = position.coords.longitude;
    
    map.setView([currentUserPosition.lat, currentUserPosition.lng], 16);
    L.marker([currentUserPosition.lat, currentUserPosition.lng]).addTo(map).bindPopup("You are here!").openPopup();

    try {
        // Use the Plus Codes library, which is now loaded correctly
        const plusCode = OpenLocationCode.encode(currentUserPosition.lat, currentUserPosition.lng);

        if (plusCode) {
            currentW3WAddress = plusCode;
            w3wAddressEl.textContent = `+${currentW3WAddress}`; // Display with a +
            recordBtn.disabled = false;
        } else {
            throw new Error("Could not generate Plus Code.");
        }
    } catch (error) {
        console.error("Plus Code error:", error);
        w3wAddressEl.textContent = "Error generating location code.";
    }
}

function onLocationError(error) {
    w3wAddressEl.textContent = `Error getting location: ${error.message}`;
}

// === 4. RECORDING & UPLOAD FLOW ===
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

async function uploadAndSaveEcho() {
    if (audioChunks.length === 0) return;
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const fileName = `echo_${currentW3WAddress.replace(/\+/g, '-')}_${Date.now()}.webm`;

    try {
        const presignedUrlRes = await fetch(`${API_URL}/presigned-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, fileType: audioBlob.type })
        });
        if (!presignedUrlRes.ok) throw new Error(`Presigned URL fetch failed: ${await presignedUrlRes.text()}`);
        const { url: uploadUrl } = await presignedUrlRes.json();

        const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: audioBlob, headers: { 'Content-Type': audioBlob.type } });
        if (!uploadRes.ok) throw new Error('Upload to R2 failed');
        const audio_url = uploadUrl.split('?')[0];

        const saveEchoRes = await fetch(`${API_URL}/echoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                w3w_address: currentW3WAddress, // Storing the Plus Code here
                audio_url: audio_url,
                lat: currentUserPosition.lat,
                lng: currentUserPosition.lng
            })
        });
        if (!saveEchoRes.ok) throw new Error('Save echo metadata failed');
        
        const newEcho = await saveEchoRes.json();
        alert(`Success! Echo saved.`);
        w3wAddressEl.textContent = `+${currentW3WAddress}`;
        renderEchoesOnMap([newEcho]);

    } catch (error) {
        console.error('Full echo process failed:', error);
        alert('An error occurred. Check console.');
        w3wAddressEl.textContent = `+${currentW3WAddress}`;
    } finally {
        recordBtn.disabled = false;
    }
}

// --- KICK IT OFF ---
recordBtn.disabled = true;
initializeApp();