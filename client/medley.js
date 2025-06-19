// client/medley.js

const API_URL = 'https://echoes-server.onrender.com';

// --- GLOBAL STATE ---
let map, userPosition;
let dropTrackBtn, dropModal, spotifySearchInput, spotifyResultsContainer, selectionPreview, selectedItemDisplay, confirmDropBtn;
let statusBar;
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
    statusBar = document.getElementById('global-status-bar');

    initializeMap();
    setupEventListeners();
    getUserLocation();
});

function initializeMap() {
    map = L.map('map', { zoomControl: true }).setView([51.505, -0.09], 13);
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
    statusBar.textContent = message;
    statusBar.className = `global-status-bar ${type}`;
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

function renderDropsOnMap(drops) {
    drops.forEach(drop => {
        L.marker([drop.lat, drop.lng], { icon: dropIcon })
          .addTo(map)
          .bindPopup(`
              <h4>${drop.item_name}</h4>
              <p>by ${drop.artist_name || 'Various Artists'}</p>
              <iframe style="border-radius:12px" src="https://open.spotify.com/embed?uri=${drop.spotify_uri}" width="100%" height="80" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
          `);
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
        
        div.innerHTML = `
            <img src="${image}" alt="${name}">
            <div class="result-info">
                <h4>${name}</h4>
                <p>${artist}</p>
            </div>
        `;
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
    selectedItemDisplay.innerHTML = `
        <img src="${selectedItem.album_art_url}" alt="Album Art">
        <div class="result-info">
            <h4>${selectedItem.item_name}</h4>
            <p>${selectedItem.artist_name}</p>
        </div>
    `;
    
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