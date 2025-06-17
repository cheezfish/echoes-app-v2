// client/app.js - FINAL VERSION WITH SURGICAL ICON UPDATE

const API_URL = 'https://echoes-server.onrender.com';
const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev'; // MAKE SURE THIS IS CORRECT

// --- ICONS (No changes) ---
const userLocationIcon = L.icon({ /* ... */ });
const echoIconFresh = L.icon({ /* ... */ });
const echoIconStable = L.icon({ /* ... */ });
const echoIconFading = L.icon({ /* ... */ });

// --- DOM ELEMENTS (No changes) ---
const mapContainer=document.getElementById("map"),w3wAddressEl=document.getElementById("w3w-address"),recordBtn=document.getElementById("record-btn"),loginBtn=document.getElementById("login-btn"),registerBtn=document.getElementById("register-btn"),logoutBtn=document.getElementById("logout-btn"),welcomeMessage=document.getElementById("welcome-message"),authModal=document.getElementById("auth-modal"),closeModalBtn=document.querySelector(".close-btn"),authForm=document.getElementById("auth-form"),modalTitle=document.getElementById("modal-title"),modalSubmitBtn=document.getElementById("modal-submit-btn"),modalError=document.getElementById("modal-error"),usernameInput=document.getElementById("username"),passwordInput=document.getElementById("password");

// --- APP STATE (One new addition) ---
let map, mediaRecorder, audioChunks = [], currentUserPosition = { lat: 0, lng: 0 }, currentBucketKey = '', markers, userToken = null, loggedInUser = null;
let echoMarkersMap = new Map(); // <<< NEW: To store a reference to each marker by its ID

// === 1. INITIALIZE & EVENT LISTENERS ===
function initializeApp(){map=L.map(mapContainer).setView([51.505,-.09],13),L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map),markers=L.markerClusterGroup(),map.addLayer(markers),setupEventListeners(),checkLoginState(),fetchAllEchoes(),"geolocation"in navigator?navigator.geolocation.getCurrentPosition(onLocationSuccess,onLocationError):w3wAddressEl.textContent="Geolocation not supported."}
function setupEventListeners(){loginBtn.addEventListener("click",()=>openModal("login")),registerBtn.addEventListener("click",()=>openModal("register")),logoutBtn.addEventListener("click",handleLogout),closeModalBtn.addEventListener("click",closeModal),authModal.addEventListener("click",e=>{e.target===authModal&&closeModal()}),authForm.addEventListener("submit",handleAuthFormSubmit),recordBtn.addEventListener("click",handleRecordClick)}

// === 2. AUTHENTICATION (No changes) ===
function openModal(e){modalError.textContent="",authForm.reset(),"login"===e?(modalTitle.textContent="Login",modalSubmitBtn.textContent="Login",authForm.dataset.mode="login"):(modalTitle.textContent="Register",modalSubmitBtn.textContent="Register",authForm.dataset.mode="register"),authModal.style.display="flex"}
function closeModal(){authModal.style.display="none"}
async function handleAuthFormSubmit(e){e.preventDefault(),modalError.textContent="";const o=usernameInput.value,t=passwordInput.value,n=authForm.dataset.mode,s="login"===n?"/api/users/login":"/api/users/register";try{const c=await fetch(`${API_URL}${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:o,password:t})}),d=await c.json();if(!c.ok)throw new Error(d.error||"An unknown error occurred.");"register"===n?(alert("Registration successful! Please log in."),openModal("login")):(localStorage.setItem("echoes_token",d.token),checkLoginState(),closeModal())}catch(c){modalError.textContent=c.message}}
function checkLoginState(){const e=localStorage.getItem("echoes_token");e?(userToken=e,loggedInUser=JSON.parse(atob(e.split(".")[1])).user.username,updateUIAfterLogin()):updateUIAfterLogout()}
function handleLogout(){localStorage.removeItem("echoes_token"),userToken=null,loggedInUser=null,updateUIAfterLogout()}
function updateUIAfterLogin(){welcomeMessage.textContent=`Welcome, ${loggedInUser}!`,loginBtn.style.display="none",registerBtn.style.display="none",logoutBtn.style.display="inline-block",currentBucketKey&& (recordBtn.disabled = false)}
function updateUIAfterLogout(){welcomeMessage.textContent="",loginBtn.style.display="inline-block",registerBtn.style.display="inline-block",logoutBtn.style.display="none",recordBtn.disabled=!0, w3wAddressEl.textContent = "Please Login or Register to leave an echo.";}

// === 3. MAP & DATA FETCHING (UPGRADED) ===
async function fetchAllEchoes() {
    // <<< UPGRADED: Clear the old markers AND our reference map >>>
    markers.clearLayers();
    echoMarkersMap.clear();
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
            const ageInHours = (new Date() - new Date(echo.last_played_at)) / (1000 * 60 * 60);
            let icon = ageInHours < 48 ? echoIconFresh : (ageInHours < 360 ? echoIconStable : echoIconFading);
            
            const marker = L.marker([echo.lat, echo.lng], { icon: icon });
            marker.bindPopup(createEchoPopup(echo));
            
            // <<< UPGRADED: Save a reference to the marker >>>
            echoMarkersMap.set(echo.id, marker);
            markers.addLayer(marker);
        }
    });
}

function createEchoPopup(echo) {
    const author = echo.username ? `by ${echo.username}` : 'by an anonymous user';
    return `
        <h3>Echo Location</h3>
        <p>Recorded on: ${new Date(echo.created_at).toLocaleDateString()} ${author}</p>
        <audio controls onplay="keepEchoAlive(${echo.id})" src="${echo.audio_url}"></audio>
    `;
}

// <<< UPGRADED: The new "Heartbeat" function >>>
window.keepEchoAlive = async (echoId) => {
    console.log(`Sending keep-alive for echo ID: ${echoId}`);
    try {
        // Send the heartbeat to the server in the background
        fetch(`${API_URL}/api/echoes/${echoId}/play`, { method: 'POST' });

        // Now, update the icon on the map INSTANTLY without a full refresh
        const markerToUpdate = echoMarkersMap.get(echoId);
        if (markerToUpdate) {
            markerToUpdate.setIcon(echoIconFresh);
        }
    } catch (error) {
        console.error("Failed to send keep-alive ping:", error);
    }
};


// === GEOLOCATION, RECORDING, UPLOAD (Unchanged) ===
function onLocationSuccess(e){currentUserPosition.lat=e.coords.latitude,currentUserPosition.lng=e.coords.longitude,map.setView([currentUserPosition.lat,currentUserPosition.lng],16),L.marker([currentUserPosition.lat,currentUserPosition.lng],{icon:userLocationIcon}).addTo(map).bindPopup("You are here!");const o=currentUserPosition.lat.toFixed(4),t=currentUserPosition.lng.toFixed(4);currentBucketKey=`sq_${o}_${t}`,w3wAddressEl.textContent="You are ready to record an echo.",userToken&&(recordBtn.disabled=!1)}
function onLocationError(e){w3wAddressEl.textContent=`Error getting location: ${e.message}`}
async function handleRecordClick(){if(mediaRecorder&&"recording"===mediaRecorder.state)mediaRecorder.stop(),recordBtn.textContent="Record Echo",recordBtn.style.backgroundColor="#007bff",recordBtn.disabled=!0,w3wAddressEl.textContent="Processing...";else try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});mediaRecorder=new MediaRecorder(e,{mimeType:"audio/webm"}),audioChunks=[],mediaRecorder.ondataavailable=e=>{audioChunks.push(e.data)},mediaRecorder.onstop=uploadAndSaveEcho,mediaRecorder.start(),recordBtn.textContent="Stop Recording",recordBtn.style.backgroundColor="#dc3545"}catch(e){console.error("Mic error:",e),w3wAddressEl.textContent="Could not access microphone."}}
async function uploadAndSaveEcho(){if(0!==audioChunks.length){const e=new Blob(audioChunks,{type:"audio/webm"}),o=`echo_${currentBucketKey}_${Date.now()}.webm`;try{const t=await fetch(`${API_URL}/presigned-url`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileName:o,fileType:e.type})});if(!t.ok)throw new Error(`Presigned URL failed: ${await t.text()}`);const{url:r}=await t.json(),n=await fetch(r,{method:"PUT",body:e,headers:{"Content-Type":e.type}});if(!n.ok)throw new Error("Upload to R2 failed");const c=`${R2_PUBLIC_URL_BASE}/${o}`,s=await fetch(`${API_URL}/echoes`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${userToken}`},body:JSON.stringify({w3w_address:currentBucketKey,audio_url:c,lat:currentUserPosition.lat,lng:currentUserPosition.lng})});if(!s.ok)throw new Error("Save metadata failed");const d=await s.json();alert("Success! Echo saved."),w3wAddressEl.textContent="You are ready to record an echo.",d.username=loggedInUser,renderEchoesOnMap([d])}catch(e){console.error("Full echo process failed:",e),alert("An error occurred. Check console."),w3wAddressEl.textContent="You are ready to record an echo."}finally{recordBtn.disabled=!1}}else w3wAddressEl.textContent="You are ready to record an echo.",recordBtn.disabled=!1}


// --- KICK IT OFF ---
initializeApp();