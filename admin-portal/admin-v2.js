// admin-portal/admin.js - GORGEOUS UI - FINAL, TESTED VERSION

const API_URL = 'https://echoes-server.cheezfish.com';

// --- DOM ELEMENT VARIABLES (Declared globally) ---
let loginSection, loginForm, loginError, usernameInput, passwordInput,
    dashboardSection, logoutBtn, navTabs, tabContents,
    statTotalEchoes, statTotalUsers, statEchoes24h, statUsers24h,
    echoSearchInput, adminMapContainer, echoesTableBody,
    usersTableBody, pruneBtn, pruneStatus, purgeBtn, purgeStatus;

// --- APP STATE ---
let adminMap, adminMarkers;
let adminToken = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Assign all DOM elements once the page is loaded
    loginSection = document.getElementById('admin-login-section');
    loginForm = document.getElementById('admin-login-form');
    loginError = document.getElementById('admin-login-error');
    usernameInput = document.getElementById('admin-username');
    passwordInput = document.getElementById('admin-password');
    dashboardSection = document.getElementById('admin-dashboard-section');
    logoutBtn = document.getElementById('admin-logout-btn');
    navTabs = document.querySelectorAll('.nav-tab');
    tabContents = document.querySelectorAll('.tab-content');
    statTotalEchoes = document.getElementById('stat-total-echoes');
    statTotalUsers = document.getElementById('stat-total-users');
    statEchoes24h = document.getElementById('stat-echoes-24h');
    statUsers24h = document.getElementById('stat-users-24h');
    echoSearchInput = document.getElementById('echo-search-input');
    adminMapContainer = document.getElementById('admin-map');
    echoesTableBody = document.querySelector('#echoes-table tbody');
    usersTableBody = document.getElementById('users-table-body');
    pruneBtn = document.getElementById('prune-echoes-btn');
    pruneStatus = document.getElementById('prune-status');
    purgeBtn = document.getElementById('purge-storage-btn');
    purgeStatus = document.getElementById('purge-storage-status');
    
    // Attach all event listeners
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    navTabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    pruneBtn.addEventListener('click', handlePrune);
    purgeBtn.addEventListener('click', handlePurge);
    echoSearchInput.addEventListener('input', debounce(fetchAllEchoesForAdmin, 500));

    // Initial check for token to determine UI state
    adminToken = localStorage.getItem('echoes_admin_token');
    updateAdminUI();
});


function updateAdminUI() {
    if (adminToken) {
        loginSection.style.display = 'none';
        dashboardSection.style.display = 'block';
        if (!adminMap) initializeAdminMap();
        fetchDashboardData();
    } else {
        loginSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        if (adminMap) { adminMap.remove(); adminMap = null; }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    loginError.textContent = 'Logging in...';
    try {
        const response = await fetch(`${API_URL}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        
        const adminCheckResponse = await fetch(`${API_URL}/admin/api/users`, { headers: { 'Authorization': `Bearer ${data.token}` } });
        if (adminCheckResponse.status === 403) throw new Error('Not authorized for admin access.');
        if (!adminCheckResponse.ok) throw new Error('Admin verification failed.');
        
        localStorage.setItem('echoes_admin_token', data.token);
        adminToken = data.token;
        updateAdminUI();
    } catch (error) {
        loginError.textContent = error.message;
    }
}

function handleLogout() {
    localStorage.removeItem('echoes_admin_token');
    adminToken = null;
    updateAdminUI();
}

function switchTab(tabId) {
    tabContents.forEach(content => content.classList.remove('active'));
    navTabs.forEach(tab => tab.classList.remove('active'));
    document.getElementById(`${tabId}-view`).classList.add('active');
    document.querySelector(`.nav-tab[data-tab='${tabId}']`).classList.add('active');
    if (tabId === 'echoes' && adminMap) {
        setTimeout(() => adminMap.invalidateSize(), 10);
    }
    if (tabId === 'dashboard') fetchDashboardData();
    if (tabId === 'echoes') fetchAllEchoesForAdmin();
    if (tabId === 'users') fetchAllUsersForAdmin();
}

async function fetchData(endpoint) {
    if (!adminToken) return null;
    try {
        const response = await fetch(`${API_URL}${endpoint}`, { headers: { 'Authorization': `Bearer ${adminToken}` } });
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch ${endpoint}:`, error);
        return null;
    }
}

async function fetchDashboardData() {
    statTotalEchoes.textContent = '...'; statTotalUsers.textContent = '...'; statEchoes24h.textContent = '...'; statUsers24h.textContent = '...';
    const [echoes, users] = await Promise.all([ fetchData('/admin/api/echoes'), fetchData('/admin/api/users') ]);
    if (echoes) {
        const now = new Date();
        statTotalEchoes.textContent = echoes.length;
        statEchoes24h.textContent = echoes.filter(e => (now - new Date(e.created_at)) < 24 * 3600 * 1000).length;
    } else { statTotalEchoes.textContent = 'Error'; statEchoes24h.textContent = 'Error'; }
    if (users) {
        const now = new Date();
        statTotalUsers.textContent = users.length;
        statUsers24h.textContent = users.filter(u => (now - new Date(u.created_at)) < 24 * 3600 * 1000).length;
    } else { statTotalUsers.textContent = 'Error'; statUsers24h.textContent = 'Error'; }
}

async function fetchAllEchoesForAdmin() {
    const echoes = await fetchData(`/admin/api/echoes?searchUser=${echoSearchInput.value}`);
    if (echoes) { renderEchoesTable(echoes); renderEchoesOnAdminMap(echoes); }
}

async function fetchAllUsersForAdmin() {
    const users = await fetchData('/admin/api/users');
    if (users) renderUsersTable(users);
}

function renderEchoesTable(echoes) {
    echoesTableBody.innerHTML = "";
    if (!echoes || echoes.length === 0) return void(echoesTableBody.innerHTML = '<tr><td colspan="7">No echoes found.</td></tr>');
    echoes.forEach(echo => {
        const row = echoesTableBody.insertRow();
        const latNum = parseFloat(echo.lat), lngNum = parseFloat(echo.lng);
        row.innerHTML = `<td>${echo.id}</td><td>${echo.username||"Anon"}</td><td>${echo.w3w_address}</td><td>${new Date(echo.created_at).toLocaleString()}</td><td>${echo.play_count}</td><td><audio controls src="${echo.audio_url}"></audio></td><td><button class="delete-echo-btn" data-id="${echo.id}">Delete</button></td>`;
    });
    document.querySelectorAll(".delete-echo-btn").forEach(btn => btn.addEventListener("click", handleDeleteEcho));
}

function renderEchoesOnAdminMap(echoes) {
    if (!adminMap) return;
    adminMarkers.clearLayers();
    if (!echoes) return;
    echoes.forEach(echo => {
        const latNum = parseFloat(echo.lat), lngNum = parseFloat(echo.lng);
        if (!isNaN(latNum) && !isNaN(lngNum)) {
            L.marker([latNum, lngNum]).bindPopup(`<b>ID:</b> ${echo.id}<br><b>Author:</b> ${echo.username||"Anon"}<br><b>Location:</b> ${echo.w3w_address}<br><a href="${echo.audio_url}" target="_blank">Play</a>`).addTo(adminMarkers);
        }
    });
}

function renderUsersTable(users) {
    usersTableBody.innerHTML = "";
    if (!users || users.length === 0) return void(usersTableBody.innerHTML = '<tr><td colspan="5">No users found.</td></tr>');
    users.forEach(user => {
        const row = usersTableBody.insertRow();
        row.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${new Date(user.created_at).toLocaleString()}</td><td>${user.is_admin}</td><td><button class="toggle-admin-btn" data-id="${user.id}" data-isadmin="${user.is_admin}">${user.is_admin?"Remove Admin":"Make Admin"}</button></td>`;
    });
    document.querySelectorAll(".toggle-admin-btn").forEach(btn => btn.addEventListener("click", handleToggleAdmin));
}

async function handleDeleteEcho(e){const o=e.target.dataset.id;if(!confirm(`Delete echo ID ${o}?`))return;try{const t=await fetch(`${API_URL}/admin/api/echoes/${o}`,{method:"DELETE",headers:{Authorization:`Bearer ${adminToken}`}}),n=await t.json();if(!t.ok)throw new Error(n.error||n.msg||"Failed to delete");alert(n.msg||"Echo deleted."),fetchAllEchoesForAdmin()}catch(t){alert(`Error: ${t.message}`)}}
async function handleToggleAdmin(e){const o=e.target.dataset.id,t="true"===e.target.dataset.isadmin;if(!confirm(`${t?"Remove admin from":"Make admin"} user ID ${o}?`))return;try{const n=await fetch(`${API_URL}/admin/api/users/${o}/toggle-admin`,{method:"PUT",headers:{Authorization:`Bearer ${adminToken}`}}),s=await n.json();if(!n.ok)throw new Error(s.error||"Failed to toggle status");alert("User admin status updated."),fetchAllUsersForAdmin()}catch(n){alert(`Error: ${n.message}`)}}
async function handlePrune(){if("PRUNE"!==prompt("Type 'PRUNE' to confirm."))return;pruneStatus.textContent="Pruning...";pruneBtn.disabled=!0;try{const e=await fetch(`${API_URL}/admin/api/echoes/prune`,{method:"POST",headers:{Authorization:`Bearer ${adminToken}`}}),o=await e.json();if(!e.ok)throw new Error(o.error);pruneStatus.textContent=o.msg,fetchAllEchoesForAdmin()}catch(e){pruneStatus.textContent=`Error: ${e.message}`}finally{pruneBtn.disabled=!1}}
async function handlePurge(){if(!confirm("Permanently delete unused audio files?"))return;purgeStatus.textContent="Scanning...";purgeBtn.disabled=!0;try{const e=await fetch(`${API_URL}/admin/api/storage/purge-orphans`,{method:"POST",headers:{Authorization:`Bearer ${adminToken}`}}),o=await e.json();if(!e.ok)throw new Error(o.error);purgeStatus.textContent=o.message}catch(e){purgeStatus.textContent=`Error: ${e.message}`}finally{purgeBtn.disabled=!1}}

function initializeAdminMap() {
    if (!adminMapContainer || adminMap) return;
    adminMap = L.map(adminMapContainer).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(adminMap);
    adminMarkers = L.markerClusterGroup();
    adminMap.addLayer(adminMarkers);
}

let debounceTimer;
function debounce(func, delay) { return function() { const context = this, args = arguments; clearTimeout(debounceTimer); debounceTimer = setTimeout(() => func.apply(context, args), delay); } }