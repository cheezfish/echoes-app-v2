/**
 * ECHOES ADMIN TERMINAL - CORE ENGINE
 * Modern Vanilla JS Implementation
 */

const API_URL = 'https://echoes-server.cheezfish.com';

// State Management
const State = {
    token: localStorage.getItem('echoes_admin_token'),
    map: null,
    markers: null,
    activeTab: 'dashboard'
};

// DOM Cache
const UI = {
    loginSection: document.getElementById('admin-login-section'),
    dashboardSection: document.getElementById('admin-dashboard-section'),
    loginForm: document.getElementById('admin-login-form'),
    loginError: document.getElementById('admin-login-error'),
    
    // Stats
    stats: {
        totalEchoes: document.getElementById('stat-total-echoes'),
        totalUsers: document.getElementById('stat-total-users'),
        echoes24h: document.getElementById('stat-echoes-24h'),
        users24h: document.getElementById('stat-users-24h')
    },

    // Tables
    echoesTable: document.querySelector('#echoes-table tbody'),
    usersTable: document.getElementById('users-table-body'),
    
    // Controls
    searchInput: document.getElementById('echo-search-input'),
    navTabs: document.querySelectorAll('.nav-item, .nav-tab'), // Supports both old/new class names
    tabContents: document.querySelectorAll('.tab-content')
};

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    if (State.token) {
        showDashboard();
    } else {
        showLogin();
    }
    setupEventListeners();
});

function setupEventListeners() {
    // Login Submission
    UI.loginForm?.addEventListener('submit', handleLogin);

    // Logout
    document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
        localStorage.removeItem('echoes_admin_token');
        location.reload();
    });

    // Navigation Tab Switching
    UI.navTabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Search with Debounce
    UI.searchInput?.addEventListener('input', debounce(() => {
        if (State.activeTab === 'echoes') fetchEchoes();
    }, 500));

    // Maintenance Actions
    document.getElementById('prune-echoes-btn')?.addEventListener('click', handlePrune);
    document.getElementById('purge-storage-btn')?.addEventListener('click', handlePurge);
}

/**
 * AUTHENTICATION
 */
async function handleLogin(e) {
    e.preventDefault();
    UI.loginError.textContent = 'Authenticating...';
    
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

        // Check Admin Privileges
        const adminCheck = await fetch(`${API_URL}/admin/api/users`, {
            headers: { 'Authorization': `Bearer ${data.token}` }
        });

        if (adminCheck.status === 403) throw new Error('Access Denied: Not an admin.');
        if (!adminCheck.ok) throw new Error('Admin verification failed.');

        localStorage.setItem('echoes_admin_token', data.token);
        State.token = data.token;
        showDashboard();
    } catch (err) {
        UI.loginError.textContent = err.message;
        UI.loginError.classList.add('error');
    }
}

function showLogin() {
    UI.loginSection.style.display = 'flex';
    UI.dashboardSection.style.display = 'none';
}

function showDashboard() {
    UI.loginSection.style.display = 'none';
    UI.dashboardSection.style.display = 'flex';
    switchTab('dashboard');
}

/**
 * NAVIGATION & TAB LOGIC
 */
function switchTab(tabId) {
    State.activeTab = tabId;

    // Update UI Classes
    UI.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-view`);
    });

    UI.navTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    // Load Data based on Tab
    switch (tabId) {
        case 'dashboard':
            refreshDashboardStats();
            break;
        case 'echoes':
            if (!State.map) initMap();
            fetchEchoes();
            setTimeout(() => State.map?.invalidateSize(), 200);
            break;
        case 'users':
            fetchUsers();
            break;
    }
}

/**
 * DATA FETCHING & STATS (The Fix)
 */
async function refreshDashboardStats() {
    // Show loading state
    Object.values(UI.stats).forEach(el => el.textContent = '...');

    const [echoes, users] = await Promise.all([
        apiFetch('/admin/api/echoes'),
        apiFetch('/admin/api/users')
    ]);

    const now = new Date();
    const oneDayInMs = 24 * 60 * 60 * 1000;

    if (echoes && Array.isArray(echoes)) {
        UI.stats.totalEchoes.textContent = echoes.length;
        const recentEchoes = echoes.filter(e => (now - new Date(e.created_at)) < oneDayInMs);
        UI.stats.echoes24h.textContent = recentEchoes.length;
    }

    if (users && Array.isArray(users)) {
        UI.stats.totalUsers.textContent = users.length;
        const recentUsers = users.filter(u => (now - new Date(u.created_at)) < oneDayInMs);
        UI.stats.users24h.textContent = recentUsers.length;
    }
}

async function fetchEchoes() {
    const query = UI.searchInput?.value || '';
    const echoes = await apiFetch(`/admin/api/echoes?searchUser=${query}`);
    if (!echoes) return;

    renderEchoesTable(echoes);
    renderMapMarkers(echoes);
}

async function fetchUsers() {
    const users = await apiFetch('/admin/api/users');
    if (users) renderUsersTable(users);
}

/**
 * RENDERING LOGIC
 */
function renderEchoesTable(echoes) {
    if (!UI.echoesTable) return;
    
    if (echoes.length === 0) {
        UI.echoesTable.innerHTML = '<tr><td colspan="7">No echoes found.</td></tr>';
        return;
    }

    UI.echoesTable.innerHTML = echoes.map(echo => `
        <tr>
            <td>${echo.id}</td>
            <td><span class="user-pill">${echo.username || 'Anon'}</span></td>
            <td><small>${echo.w3w_address || 'Unknown'}</small></td>
            <td>${new Date(echo.created_at).toLocaleDateString()}</td>
            <td>${echo.play_count}</td>
            <td>
                <audio controls src="${echo.audio_url}"></audio>
            </td>
            <td>
                <button class="btn-danger" onclick="deleteEcho(${echo.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}

function renderUsersTable(users) {
    if (!UI.usersTable) return;
    
    UI.usersTable.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td>
                <span class="badge ${user.is_admin ? 'admin' : 'user'}">
                    ${user.is_admin ? 'Admin' : 'User'}
                </span>
            </td>
            <td>
                <button class="btn-warning" onclick="toggleAdmin(${user.id}, ${user.is_admin})">
                    ${user.is_admin ? 'Demote' : 'Make Admin'}
                </button>
            </td>
        </tr>
    `).join('');
}

/**
 * MAP LOGIC
 */
function initMap() {
    const mapContainer = document.getElementById('admin-map');
    if (!mapContainer || State.map) return;

    State.map = L.map(mapContainer).setView([20, 0], 2);
    
    // Dark Mode Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB'
    }).addTo(State.map);

    State.markers = L.markerClusterGroup();
    State.map.addLayer(State.markers);
}

function renderMapMarkers(echoes) {
    if (!State.markers) return;
    State.markers.clearLayers();

    echoes.forEach(echo => {
        const lat = parseFloat(echo.lat);
        const lng = parseFloat(echo.lng);
        
        if (!isNaN(lat) && !isNaN(lng)) {
            const marker = L.marker([lat, lng])
                .bindPopup(`
                    <div class="map-popup">
                        <strong>${echo.username || 'Anon'}</strong><br>
                        ${echo.w3w_address}<br>
                        <audio src="${echo.audio_url}" controls></audio>
                    </div>
                `);
            State.markers.addLayer(marker);
        }
    });
}

/**
 * ACTIONS
 */
async function deleteEcho(id) {
    if (!confirm(`Permanently delete echo #${id}?`)) return;
    try {
        const res = await apiFetch(`/admin/api/echoes/${id}`, { method: 'DELETE' });
        if (res) fetchEchoes();
    } catch (err) { alert(err.message); }
}

async function toggleAdmin(userId, currentStatus) {
    const action = currentStatus ? 'Remove admin from' : 'Make admin';
    if (!confirm(`${action} user #${userId}?`)) return;

    try {
        await apiFetch(`/admin/api/users/${userId}/toggle-admin`, { method: 'PUT' });
        fetchUsers();
    } catch (err) { alert(err.message); }
}

async function handlePrune() {
    if (!confirm("This will delete all echoes older than 20 days with 0 plays. Proceed?")) return;
    const statusEl = document.getElementById('prune-status');
    statusEl.textContent = "Pruning...";
    
    try {
        const res = await apiFetch('/admin/api/echoes/prune', { method: 'POST' });
        statusEl.textContent = res.msg || "Prune successful";
        statusEl.className = "status-text success";
        refreshDashboardStats();
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "status-text error";
    }
}

async function handlePurge() {
    if (!confirm("Delete all audio files in R2 not associated with a database entry?")) return;
    const statusEl = document.getElementById('purge-storage-status');
    statusEl.textContent = "Purging...";

    try {
        const res = await apiFetch('/admin/api/storage/purge-orphans', { method: 'POST' });
        statusEl.textContent = res.message || "Purge complete";
        statusEl.className = "status-text success";
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "status-text error";
    }
}

/**
 * UTILS
 */
async function apiFetch(endpoint, options = {}) {
    const headers = {
        'Authorization': `Bearer ${State.token}`,
        'Content-Type': 'application/json',
        ...options.headers
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
        if (response.status === 401) {
            localStorage.removeItem('echoes_admin_token');
            location.reload();
            return null;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.msg || 'API Error');
        return data;
    } catch (err) {
        console.error(`Fetch error [${endpoint}]:`, err);
        return null;
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}