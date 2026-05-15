// client/medley.js

const API_URL = 'https://echoes-server.cheezfish.com';

/** Escapes a string for safe insertion into HTML attribute or text content */
function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

// --- GLOBAL STATE ---
let map, userPosition;
let dropTrackBtn, dropModal, spotifySearchInput, spotifyResultsContainer, selectionPreview, selectedItemDisplay, confirmDropBtn;
let toastContainer;
let searchTimeout = null;
let selectedItem = null;

// --- ICONS ---
const dropIcon = L.icon({
    iconUrl: 'https://api.iconify.design/ph:vinyl-record-fill.svg?color=%231db954',
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -42]
});

/** Main initialization on page load */
document.addEventListener('DOMContentLoaded', () => {
    // Cache UI elements
    dropTrackBtn = document.getElementById('drop-track-btn');
    dropModal = document.getElementById('drop-modal');
    spotifySearchInput = document.getElementById('spotify-search-input');
    spotifyResultsContainer = document.getElementById('spotify-results-container');
    selectionPreview = document.getElementById('selection-preview');
    selectedItemDisplay = document.getElementById('selected-item-display');
    confirmDropBtn = document.getElementById('confirm-drop-btn');
    toastContainer = document.getElementById('toast-container');

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('Service Worker registered successfully.'))
            .catch(error => console.error('Service Worker registration failed:', error));
    }

    const params = new URLSearchParams(window.location.search);
    const sharedText = params.get('shared_text');

    if (sharedText) {
        console.log(`Share received! Content: ${sharedText}`);
        // For now, just show an alert to prove it works.
        alert(`Received a share: ${sharedText}`);
        // We can also pre-fill the search bar
        spotifySearchInput.value = sharedText;
        searchSpotify(sharedText);
        // Open the modal automatically for a better UX
        dropModal.style.display = 'flex';
    }

    initializeMap();
    setupEventListeners();
    getUserLocation();
});

function initializeMap() {
    map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 13);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=oeJYklnaUPpZgpHgTszf', {
        maxZoom: 19,
        attribution: '© Stadia Maps, © OpenStreetMap contributors'
    }).addTo(map);
}

function setupEventListeners() {
    dropTrackBtn.addEventListener('click', () => {
        dropModal.style.display = 'flex';
    });

    dropModal.querySelector('.close-btn').addEventListener('click', () => {
        dropModal.style.display = 'none';
    });

    spotifySearchInput.addEventListener('keyup', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = spotifySearchInput.value;
            if (query.length > 2) {
                searchSpotify(query);
            }
        }, 500); // Debounce search
    });
    
    confirmDropBtn.addEventListener('click', handleDropConfirmation);
}

function updateStatus(message, type = 'info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast${type && type !== 'info' ? ' ' + type : ''}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

function getUserLocation() {
    if (!('geolocation' in navigator)) {
        updateStatus("Geolocation is not available.", "error");
        return;
    }
    navigator.geolocation.getCurrentPosition(position => {
        userPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        map.flyTo([userPosition.lat, userPosition.lng], 14);
        L.marker([userPosition.lat, userPosition.lng]).addTo(map); // Add user marker
        dropTrackBtn.disabled = false;
        updateStatus("Location found. You can now drop a track.", "success");
        fetchNearbyDrops();
    }, () => {
        updateStatus("Could not get your location. Please enable location services.", "error");
    });
}

async function fetchNearbyDrops() {
    if (!userPosition) return;
    updateStatus("Scanning for nearby drops...");
    try {
        const response = await fetch(`${API_URL}/api/medley/drops?lat=${userPosition.lat}&lng=${userPosition.lng}`);
        const drops = await response.json();
        renderDropsOnMap(drops);
        updateStatus(`Found ${drops.length} drops within 20km.`, "success");
    } catch (error) {
        updateStatus("Failed to fetch drops.", "error");
    }
}

// In medley.js

function renderDropsOnMap(drops) {
    // No change to the start of the function
    drops.forEach(drop => {
        // --- THIS IS THE UPDATED PART ---

        // 1. Define the custom HTML content for our new popup
        const popupWrap = document.createElement('div');
        popupWrap.className = 'medley-popup-content';
        const popupH3 = document.createElement('h3');
        popupH3.textContent = drop.item_name;
        const popupP = document.createElement('p');
        popupP.textContent = `by ${drop.artist_name || 'Various Artists'}`;
        const iframe = document.createElement('iframe');
        iframe.style.borderRadius = '8px';
        // Only allow well-formed spotify: URIs to reach the embed URL
        const safeUri = /^spotify:(track|album|playlist):[A-Za-z0-9]+$/.test(drop.spotify_uri)
            ? drop.spotify_uri : '';
        iframe.src = `https://open.spotify.com/embed?uri=${encodeURIComponent(safeUri)}`;
        iframe.width = '100%';
        iframe.height = '80';
        iframe.frameBorder = '0';
        iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        iframe.loading = 'lazy';
        popupWrap.appendChild(popupH3);
        popupWrap.appendChild(popupP);
        if (safeUri) popupWrap.appendChild(iframe);
        const popupContent = popupWrap;

        // 2. Define the options for the popup, including our custom class
        const popupOptions = {
            className: 'medley-popup',
            maxWidth: 300,
            minWidth: 300
        };

        // 3. Create the marker and bind the popup with the new content and options
        L.marker([drop.lat, drop.lng], { icon: dropIcon })
          .addTo(map)
          .bindPopup(popupContent, popupOptions);
    });
}

async function searchSpotify(query) {
    spotifyResultsContainer.innerHTML = 'Searching...';
    try {
        const response = await fetch(`${API_URL}/api/medley/search?q=${query}`);
        const data = await response.json();
        renderSearchResults(data);
    } catch (error) {
        spotifyResultsContainer.innerHTML = 'Search failed.';
    }
}

function renderSearchResults(data) {
    spotifyResultsContainer.innerHTML = '';
    const items = data.items || []; // Use data.items, as the server now returns the 'tracks' object
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'spotify-result-item';
        const image = (item.album?.images[0] || item.images[0] || {url: ''}).url;
        const name = item.name;
        const artist = item.type === 'track' ? item.artists.map(a => a.name).join(', ') : item.owner.display_name;
        
        const img = document.createElement('img');
        img.src = image;
        img.alt = esc(name);
        const info = document.createElement('div');
        info.className = 'result-info';
        const h4 = document.createElement('h4');
        h4.textContent = name;
        const p = document.createElement('p');
        p.textContent = artist;
        info.appendChild(h4);
        info.appendChild(p);
        div.appendChild(img);
        div.appendChild(info);
        div.onclick = () => selectItem(item);
        spotifyResultsContainer.appendChild(div);
    });
}

function selectItem(item) {
    // This is the object that will be sent to the server
    selectedItem = {
        spotify_uri: item.uri,
        item_name: item.name,
        // Handle both track and playlist artist/owner info
        artist_name: item.type === 'track' ? item.artists.map(a => a.name).join(', ') : item.owner.display_name,
        // Handle both track and playlist album art
        album_art_url: (item.album?.images[0] || item.images[0] || {url: ''}).url
    };

    // --- UPDATED HTML STRUCTURE FOR THE PREVIEW ---
    selectedItemDisplay.innerHTML = '';
    const previewImg = document.createElement('img');
    previewImg.src = selectedItem.album_art_url;
    previewImg.alt = 'Album Art';
    const previewInfo = document.createElement('div');
    previewInfo.className = 'result-info';
    const previewH4 = document.createElement('h4');
    previewH4.textContent = selectedItem.item_name;
    const previewP = document.createElement('p');
    previewP.textContent = selectedItem.artist_name;
    previewInfo.appendChild(previewH4);
    previewInfo.appendChild(previewP);
    selectedItemDisplay.appendChild(previewImg);
    selectedItemDisplay.appendChild(previewInfo);
    
    // Show the preview section
    selectionPreview.style.display = 'block';
}

async function handleDropConfirmation() {
    if (!selectedItem || !userPosition) return;
    
    updateStatus("Dropping track...", "info");
    confirmDropBtn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/api/medley/drops`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...userPosition,
                ...selectedItem
            })
        });

        if (!response.ok) throw new Error("Failed to save drop.");
        
        const newDrop = await response.json();
        renderDropsOnMap([newDrop]); // Add new drop to map immediately
        updateStatus("Track dropped successfully!", "success");
        dropModal.style.display = 'none';

    } catch (error) {
        updateStatus("Error: Could not drop track.", "error");
    } finally {
        confirmDropBtn.disabled = false;
    }
}