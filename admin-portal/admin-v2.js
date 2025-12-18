// admin-portal/admin.js - GORGEOUS UI WITH TAB LOGIC

const API_URL = 'https://echoes-server.cheezfish.com';

// --- DOM ELEMENTS (Declared globally) ---
let adminLoginForm, adminLoginError, adminLoginSection, adminDashboardSection, adminLogoutBtn,
    echoesTableBody, usersTableBody, adminMapContainer, navTabs, tabContents;

// --- APP STATE ---
let adminMap, adminMarkers;
let adminToken = null;

document.addEventListener('DOMContentLoaded', () => {
    // Assign elements
    adminLoginForm = document.getElementById('admin-login-form');
    adminLoginError = document.getElementById('admin-login-error');
    adminLoginSection = document.getElementById('admin-login-section');
    adminDashboardSection = document.getElementById('admin-dashboard-section');
    adminLogoutBtn = document.getElementById('admin-logout-btn');
    echoesTableBody = document.querySelector('#echoes-table tbody');
    usersTableBody = document.getElementById('users-table-body');
    adminMapContainer = document.getElementById('admin-map');
    navTabs = document.querySelectorAll('.nav-tab');
    tabContents = document.querySelectorAll('.tab-content');

    // Initial check for token and UI setup
    adminToken = localStorage.getItem('echoes_admin_token');
    updateAdminUI();

    // Attach event listeners
    adminLoginForm.addEventListener('submit', handleLogin);
    adminLogoutBtn.addEventListener('click', handleLogout);
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
});

function updateAdminUI() {
    if (adminToken) {
        adminLoginSection.style.display = 'none';
        adminDashboardSection.style.display = 'block';
        if (!adminMap) initializeAdminMap();
        // Fetch data for the initially active tab
        fetchAllEchoesForAdmin();
    } else {
        adminLoginSection.style.display = 'block';
        adminDashboardSection.style.display = 'none';
        if (adminMap) { adminMap.remove(); adminMap = null; }
    }
}

// --- NEW: Tab Switching Logic ---
function switchTab(tabId) {
    tabContents.forEach(content => content.classList.remove('active'));
    navTabs.forEach(tab => tab.classList.remove('active'));
    
    document.getElementById(`${tabId}-view`).classList.add('active');
    document.querySelector(`.nav-tab[data-tab='${tabId}']`).classList.add('active');

    // Invalidate map size if the echoes tab is now visible
    if (tabId === 'echoes' && adminMap) {
        setTimeout(() => adminMap.invalidateSize(), 10);
    }

    // Fetch data for the newly activated tab
    if (tabId === 'echoes') fetchAllEchoesForAdmin();
    if (tabId === 'users') fetchAllUsersForAdmin();
}

// --- All other functions (handleLogin, handleLogout, initializeAdminMap, fetchData, etc.) ---
// --- remain exactly the same as your current working version. ---
// (Full, unabridged code provided below for absolute certainty)

async function handleLogin(e) { e.preventDefault(); adminLoginError.textContent = ''; const username = document.getElementById('admin-username').value; const password = document.getElementById('admin-password').value; try { const response = await fetch(`${API_URL}/api/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Login failed'); const adminCheckResponse = await fetch(`${API_URL}/admin/api/users`, { headers: { 'Authorization': `Bearer ${data.token}` } }); if (adminCheckResponse.status === 403) throw new Error('Not authorized for admin access.'); if (!adminCheckResponse.ok) throw new Error('Admin verification failed'); localStorage.setItem('echoes_admin_token', data.token); adminToken = data.token; updateAdminUI(); } catch (error) { adminLoginError.textContent = error.message; } }
function handleLogout() { localStorage.removeItem('echoes_admin_token'); adminToken = null; updateAdminUI(); }
function initializeAdminMap() { if (!adminMapContainer || adminMap) return; adminMap = L.map(adminMapContainer).setView([20, 0], 2); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(adminMap); adminMarkers = L.markerClusterGroup(); adminMap.addLayer(adminMarkers); }
async function fetchData(endpoint) { if (!adminToken) return null; try { const response = await fetch(`${API_URL}${endpoint}`, { headers: { 'Authorization': `Bearer ${adminToken}` } }); if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`); return await response.json(); } catch (error) { console.error(error); return null; } }
async function fetchAllEchoesForAdmin() { echoesTableBody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>'; const echoes = await fetchData('/admin/api/echoes'); if (echoes) { renderEchoesTable(echoes); renderEchoesOnAdminMap(echoes); } else { echoesTableBody.innerHTML = '<tr><td colspan="7" class="error">Failed to fetch echoes.</td></tr>'; } }
async function fetchAllUsersForAdmin() { usersTableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>'; const users = await fetchData('/admin/api/users'); if (users) { renderUsersTable(users); } else { usersTableBody.innerHTML = '<tr><td colspan="5" class="error">Failed to fetch users.</td></tr>'; } }
function renderEchoesTable(echoes) { echoesTableBody.innerHTML = ""; if (echoes.length === 0) return void(echoesTableBody.innerHTML = '<tr><td colspan="7">No echoes found.</td></tr>'); echoes.forEach(echo => { const row = echoesTableBody.insertRow(); const latNum = parseFloat(echo.lat), lngNum = parseFloat(echo.lng); row.innerHTML = `<td>${echo.id}</td><td>${echo.username || "Anon"}</td><td>${echo.w3w_address}</td><td>${isNaN(latNum) ? "N/A" : latNum.toFixed(4)}</td><td>${isNaN(lngNum) ? "N/A" : lngNum.toFixed(4)}</td><td>${new Date(echo.created_at).toLocaleString()}</td><td>${echo.play_count}</td><td><audio controls src="${echo.audio_url}"></audio></td><td><button class="delete-echo-btn" data-id="${echo.id}">Delete</button></td>`; }); document.querySelectorAll(".delete-echo-btn").forEach(btn => btn.addEventListener("click", handleDeleteEcho)); }
function renderEchoesOnAdminMap(echoes) { adminMarkers.clearLayers(); echoes.forEach(echo => { const latNum = parseFloat(echo.lat), lngNum = parseFloat(echo.lng); if (!isNaN(latNum) && !isNaN(lngNum)) { L.marker([latNum, lngNum]).bindPopup(`<b>ID:</b> ${echo.id}<br><b>Author:</b> ${echo.username || "Anon"}<br><b>Location:</b> ${echo.w3w_address}<br><a href="${echo.audio_url}" target="_blank">Play</a>`).addTo(adminMarkers); } }); }
async function handleDeleteEcho(e) { const echoId = e.target.dataset.id; if (!confirm(`Delete echo ID ${echoId}?`)) return; try { const response = await fetch(`${API_URL}/admin/api/echoes/${echoId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || data.msg || "Failed to delete"); alert(data.msg || "Echo deleted."); fetchAllEchoesForAdmin(); } catch (error) { alert(`Error: ${error.message}`); } }
async function handleToggleAdmin(e) { const userId = e.target.dataset.id; const isAdmin = e.target.dataset.isadmin === 'true'; if (!confirm(`${isAdmin ? "Remove admin from" : "Make admin"} user ID ${userId}?`)) return; try { const response = await fetch(`${API_URL}/admin/api/users/${userId}/toggle-admin`, { method: "PUT", headers: { Authorization: `Bearer ${adminToken}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Failed to toggle status"); alert("User admin status updated."); fetchAllUsersForAdmin(); } catch (error) { alert(`Error: ${error.message}`); } }
function renderUsersTable(users) { usersTableBody.innerHTML = ""; if (users.length === 0) return void(usersTableBody.innerHTML = '<tr><td colspan="5">No users found.</td></tr>'); users.forEach(user => { const row = usersTableBody.insertRow(); row.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${new Date(user.created_at).toLocaleString()}</td><td>${user.is_admin}</td><td><button class="toggle-admin-btn" data-id="${user.id}" data-isadmin="${user.is_admin}">${user.is_admin ? "Remove Admin" : "Make Admin"}</button></td>`; }); document.querySelectorAll(".toggle-admin-btn").forEach(btn => btn.addEventListener("click", handleToggleAdmin)); }