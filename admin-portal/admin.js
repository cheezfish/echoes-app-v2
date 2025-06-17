// admin-portal/admin.js - WITH GLOBAL MAP

const API_URL = 'https://echoes-server.onrender.com';
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginError = document.getElementById('admin-login-error');
const adminLoginSection = document.getElementById('admin-login-section');
const adminDashboardSection = document.getElementById('admin-dashboard-section');
const adminLogoutBtn = document.getElementById('admin-logout-btn');
const echoesTableBody = document.querySelector('#echoes-table tbody');

// === NEW: Map variables ===
const adminMapContainer = document.getElementById('admin-map');
let adminMap;
let adminMarkers;
// =========================

let adminToken = localStorage.getItem('echoes_admin_token');

function updateAdminUI() {
    if (adminToken) {
        adminLoginSection.style.display = 'none';
        adminDashboardSection.style.display = 'block';
        initializeAdminMap(); // <<< NEW: Initialize map on successful login/load
        fetchAllEchoesForAdmin();
    } else {
        adminLoginSection.style.display = 'block';
        adminDashboardSection.style.display = 'none';
        if (adminMap) { // If map exists, remove it on logout
            adminMap.remove();
            adminMap = null;
        }
    }
}

adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminLoginError.textContent = '';
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    try {
        const response = await fetch(`${API_URL}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        
        try {
            const adminCheckResponse = await fetch(`${API_URL}/admin/api/echoes`, {
                headers: { 'Authorization': `Bearer ${data.token}` }
            });
            if (adminCheckResponse.status === 403) throw new Error('Not authorized for admin access.');
            if (!adminCheckResponse.ok) throw new Error('Admin data fetch failed.');
            
            localStorage.setItem('echoes_admin_token', data.token);
            adminToken = data.token;
            updateAdminUI();
        } catch (adminCheckError) {
            adminLoginError.textContent = adminCheckError.message;
        }
    } catch (error) {
        adminLoginError.textContent = error.message;
    }
});

adminLogoutBtn.addEventListener('click', () => {
    localStorage.removeItem('echoes_admin_token');
    adminToken = null;
    updateAdminUI();
});

// === NEW: Initialize Admin Map ===
function initializeAdminMap() {
    if (adminMap) return; // Don't re-initialize if it already exists
    adminMap = L.map(adminMapContainer).setView([20, 0], 2); // World view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { // Simple tiles for admin
        attribution: '© OpenStreetMap contributors'
    }).addTo(adminMap);
    adminMarkers = L.markerClusterGroup();
    adminMap.addLayer(adminMarkers);
}
// ================================

async function fetchAllEchoesForAdmin() {
    if (!adminToken) return;
    echoesTableBody.innerHTML = '<tr><td colspan="9">Loading echoes...</td></tr>';
    if (adminMarkers) adminMarkers.clearLayers(); // Clear map markers

    try {
        const response = await fetch(`${API_URL}/admin/api/echoes`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!response.ok) throw new Error('Failed to fetch echoes');
        const echoes = await response.json();
        renderEchoesTable(echoes);
        renderEchoesOnAdminMap(echoes); // <<< NEW: Render on map
    } catch (error) {
        echoesTableBody.innerHTML = `<tr><td colspan="9" class="error">${error.message}</td></tr>`;
    }
}

function renderEchoesTable(echoes) {
    echoesTableBody.innerHTML = '';
    if (echoes.length === 0) {
        echoesTableBody.innerHTML = '<tr><td colspan="9">No echoes found.</td></tr>';
        return;
    }
    echoes.forEach(echo => {
        const row = echoesTableBody.insertRow();
        // New code in renderEchoesTable
        const latNum = parseFloat(echo.lat); // Convert to number
        const lngNum = parseFloat(echo.lng); // Convert to number

        row.innerHTML = `
            <td>${echo.id}</td>
            <td>${echo.username || 'Anonymous'}</td>
            <td>${echo.w3w_address}</td>
            <td>${!isNaN(latNum) ? latNum.toFixed(4) : 'N/A'}</td> {/* Use converted number */}
            <td>${!isNaN(lngNum) ? lngNum.toFixed(4) : 'N/A'}</td> {/* Use converted number */}
            <td>${new Date(echo.created_at).toLocaleString()}</td>
            <td>${echo.play_count}</td>
            <td><audio controls src="${echo.audio_url}"></audio></td>
            <td><button class="delete-echo-btn" data-id="${echo.id}">Delete</button></td>
        `;
    });
    document.querySelectorAll('.delete-echo-btn').forEach(btn => {
        btn.addEventListener('click', handleDeleteEcho);
    });
}

// === NEW: Render Echoes on Admin Map ===
function renderEchoesOnAdminMap(echoes) {
    if (!adminMap || !adminMarkers) return;
    echoes.forEach(echo => {
        // New code in renderEchoesOnAdminMap
        if (echo.lat && echo.lng) {
            const latNum = parseFloat(echo.lat); // Convert to number
            const lngNum = parseFloat(echo.lng); // Convert to number

            if (!isNaN(latNum) && !isNaN(lngNum)) { // Only create marker if conversion is valid
                const marker = L.marker([latNum, lngNum]); 
                marker.bindPopup(`
                    <b>Echo ID:</b> ${echo.id}<br>
                    <b>Author:</b> ${echo.username || 'Anonymous'}<br>
                    <b>Location:</b> ${echo.w3w_address}<br>
                    <a href="${echo.audio_url}" target="_blank">Play Audio</a>
                `);
                adminMarkers.addLayer(marker);
            }
        }
    });
}
// =====================================

async function handleDeleteEcho(e) {
    const echoId = e.target.dataset.id;
    if (!confirm(`Are you sure you want to delete echo ID ${echoId}?`)) return;
    try {
        const response = await fetch(`${API_URL}/admin/api/echoes/${echoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const data = await response.json(); // Try to parse JSON in all cases
        if (!response.ok) throw new Error(data.error || data.msg || 'Failed to delete echo');
        alert(data.msg || 'Echo deleted successfully.');
        fetchAllEchoesForAdmin();
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

updateAdminUI();