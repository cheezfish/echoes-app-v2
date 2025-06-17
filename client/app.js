// client/app.js - WITH MARKER CLUSTERING

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // MAKE SURE THIS IS CORRECT

// --- DOM ELEMENTS ---
const mapContainer = document.getElementById('map');
const w3wAddressEl = document.getElementById('w3w-address');
const recordBtn = document.getElementById('record-btn');

// --- APP STATE ---
let map;
let mediaRecorder;
let audioChunks = [];
let currentUserPosition = { lat: 0, lng: 0 };
let currentBucketKey = '';
let markers; // <<< NEW: This will hold our cluster group

// === 1. INITIALIZE ===
function initializeApp() {
    map = L.map(mapContainer).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // <<< NEW: Initialize the cluster group and add it to the map >>>
    markers = L.markerClusterGroup();
    map.addLayer(markers);
    // <<< ======================================================= >>>

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
    // <<< NEW: Clear old markers before fetching new ones >>>
    markers.clearLayers();
    // <<< ============================================= >>>
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
            
            // <<< NEW: Add the marker to the CLUSTER GROUP, not the map >>>
            markers.addLayer(marker);
            // <<< ======================================================= >>>
        }
    });
}

function createEchoPopup(echo) { /* ... no change ... */ }
function onLocationSuccess(position) { /* ... no change ... */ }
function onLocationError(error) { /* ... no change ... */ }
async function handleRecordClick() { /* ... no change ... */ }
async function uploadAndSaveEcho() { /* ... no change ... */ }

// (Copying unchanged functions here for completeness)
function createEchoPopup(e){return`<h3>Echo Location</h3><p>Recorded on: ${new Date(e.created_at).toLocaleDateString()}</p><audio controls src="${e.audio_url}"></audio>`}
function onLocationSuccess(e){currentUserPosition.lat=e.coords.latitude,currentUserPosition.lng=e.coords.longitude,map.setView([currentUserPosition.lat,currentUserPosition.lng],16),L.marker([currentUserPosition.lat,currentUserPosition.lng]).addTo(map).bindPopup("You are here!").openPopup();const o=currentUserPosition.lat.toFixed(4),t=currentUserPosition.lng.toFixed(4);currentBucketKey=`sq_${o}_${t}`,w3wAddressEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1}
function onLocationError(e){w3wAddressEl.textContent=`Error getting location: ${e.message}`}
async function handleRecordClick(){if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),recordBtn.textContent="Record Echo",recordBtn.style.backgroundColor="#007bff",recordBtn.disabled=!0,w3wAddressEl.textContent="Processing...";else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent="Stop Recording",recordBtn.style.backgroundColor="#dc3545"}catch(e){console.error("Mic error:",e),w3wAddressEl.textContent="Could not access microphone."}}
async function uploadAndSaveEcho(){if(0!==audioChunks.length){const e=new Blob(audioChunks,{type:"audio/webm"}),o=`echo_${currentBucketKey}_${Date.now()}.webm`;try{const t=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:o,fileType:e.type})});if(!t.ok)throw new Error(`Presigned URL failed: ${await t.text()}`);const{url:r}=await t.json(),n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${o}`,d=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!d.ok)throw new Error("Save metadata failed");const s=await d.json();alert("Success! Echo saved."),w3wAddressEl.textContent="You are ready to record an echo.",renderEchoesOnMap([s])}catch(e){console.error("Full echo process failed:",e),alert("An error occurred. Check console."),w3wAddressEl.textContent="You are ready to record an echo."}finally{recordBtn.disabled=!1}}else w3wAddressEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1}

// --- KICK IT OFF ---
recordBtn.disabled = true;
initializeApp();