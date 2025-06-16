// client/app.js

//
// === CRITICAL: Make sure this URL is correct! ===
//
const API_URL = 'https://echoes-server.onrender.com'; // Replace with YOUR Render server URL if different

// --- DOM ELEMENTS ---
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const recordBtn = document.getElementById('record-btn');
const testCreateBtn = document.getElementById('test-create-btn');

// --- APP STATE ---
let map;
let mediaRecorder;
let audioChunks = [];
let currentW3WAddress = '';

// === 1. INITIALIZE THE APP ===
function initializeApp() {
    // We don't need the test button anymore
    if (testCreateBtn) {
        testCreateBtn.style.display = 'none';
    }

    // Initialize Leaflet map
    map = L.map(mapContainer).setView([51.505, -0.09], 13); // Default to London
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Get user's location
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError);
    } else {
        w3wAddressEl.textContent = "Geolocation is not supported by your browser.";
    }

    recordBtn.addEventListener('click', handleRecordClick);
}

// === 2. GEOLOCATION & WHAT3WORDS LOGIC ===
async function onLocationSuccess(position) {
    const { latitude, longitude } = position.coords;
    map.setView([latitude, longitude], 16);
    L.marker([latitude, longitude]).addTo(map).bindPopup("You are here!").openPopup();

    // TODO: Integrate what3words API here to get the real address
    // For now, we'll use a placeholder. This is fine for testing.
    currentW3WAddress = `lat_${latitude.toFixed(4)}_lng_${longitude.toFixed(4)}`;
    w3wAddressEl.textContent = `Your Square: ${currentW3WAddress}`;
    recordBtn.disabled = false; // Enable the record button
}

function onLocationError(error) {
    w3wAddressEl.textContent = `Error getting location: ${error.message}`;
}

// === 3. RECORDING LOGIC ===
async function handleRecordClick() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        // --- STOP RECORDING ---
        mediaRecorder.stop();
        recordBtn.textContent = 'Record Echo';
        recordBtn.style.backgroundColor = '#007bff';
        recordBtn.disabled = true; // Disable until processing is done
        w3wAddressEl.textContent = 'Processing your echo...';
    } else {
        // --- START RECORDING ---
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            
            audioChunks = []; // Clear previous chunks
            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = uploadAndSaveEcho; // This function runs when recording stops

            mediaRecorder.start();
            recordBtn.textContent = 'Stop Recording';
            recordBtn.style.backgroundColor = '#dc3545'; // Red color for recording
        } catch (error) {
            console.error('Error accessing microphone:', error);
            w3wAddressEl.textContent = 'Could not access microphone.';
        }
    }
}

// === 4. THE UPLOAD AND SAVE FLOW ===
async function uploadAndSaveEcho() {
    if (audioChunks.length === 0) {
        w3wAddressEl.textContent = 'No audio recorded. Please try again.';
        recordBtn.disabled = false;
        return;
    }
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const fileName = `echo_${currentW3WAddress}_${Date.now()}.webm`;

    try {
        // --- Step A: Get a presigned URL from our backend ---
        console.log('Asking backend for an upload URL...');
        const presignedUrlResponse = await fetch(`${API_URL}/presigned-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, fileType: audioBlob.type })
        });

        if (!presignedUrlResponse.ok) throw new Error(`Failed to get presigned URL: ${await presignedUrlResponse.text()}`);
        const { url: uploadUrl } = await presignedUrlResponse.json();
        console.log('Got upload URL. Uploading file directly to R2...');

        // --- Step B: Upload the audio file directly to Cloudflare R2 ---
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: audioBlob,
            headers: { 'Content-Type': audioBlob.type }
        });

        if (!uploadResponse.ok) throw new Error('Failed to upload audio to R2');
        console.log('Upload successful!');
        
        // The final URL of the object in the R2 bucket is the presigned URL without the query string
        const audio_url = uploadUrl.split('?')[0];

        // --- Step C: Save the final echo metadata to our database ---
        console.log('Saving echo metadata to our database...');
        const saveEchoResponse = await fetch(`${API_URL}/echoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ w3w_address: currentW3WAddress, audio_url })
        });
        
        if (!saveEchoResponse.ok) throw new Error('Failed to save echo metadata');

        const newEcho = await saveEchoResponse.json();
        console.log('Echo saved!', newEcho);
        w3wAddressEl.textContent = `Success! Echo ${newEcho.id} created.`;
        alert(`Success! Your echo for ${currentW3WAddress} has been saved.`);

    } catch (error) {
        console.error('The echo creation process failed:', error);
        w3wAddressEl.textContent = 'Sorry, something went wrong. Please try again.';
        alert('An error occurred. Please check the console for details.');
    } finally {
        recordBtn.disabled = false; // Re-enable the button
    }
}

// --- KICK EVERYTHING OFF ---
// Disable the button until we have a location
recordBtn.disabled = true;
initializeApp();