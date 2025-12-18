// admin-portal/admin.js - FULL UX/UI OVERHAUL

const API_URL = 'https://echoes-server.cheezfish.com';

document.addEventListener('DOMContentLoaded', () => {
    // Cache all DOM elements
    const elements = {
        loginSection: document.getElementById('admin-login-section'),
        loginForm: document.getElementById('admin-login-form'),
        loginError: document.getElementById('admin-login-error'),
        usernameInput: document.getElementById('admin-username'),
        passwordInput: document.getElementById('admin-password'),
        dashboardSection: document.getElementById('admin-dashboard-section'),
        logoutBtn: document.getElementById('admin-logout-btn'),
        navTabs: document.querySelectorAll('.nav-tab'),
        tabContents: document.querySelectorAll('.tab-content'),
        statTotalEchoes: document.getElementById('stat-total-echoes'),
        statTotalUsers: document.getElementById('stat-total-users'),
        statEchoes24h: document.getElementById('stat-echoes-24h'),
        statUsers24h: document.getElementById('stat-users-24h'),
        echoSearchInput: document.getElementById('echo-search-input'),
        adminMapContainer: document.getElementById('admin-map'),
        echoesTableBody: document.querySelector('#echoes-table tbody'),
        usersTableBody: document.getElementById('users-table-body'),
        pruneBtn: document.getElementById('prune-echoes-btn'),
        pruneStatus: document.getElementById('prune-status'),
        purgeBtn: document.getElementById('purge-storage-btn'),
        purgeStatus: document.getElementById('purge-storage-status'),
    };

    let adminMap, adminMarkers;
    let adminToken = localStorage.getItem('echoes_admin_token');

    function updateAdminUI() {
        if (adminToken) {
            elements.loginSection.style.display = 'none';
            elements.dashboardSection.style.display = 'block';
            if (!adminMap) initializeAdminMap();
            fetchDashboardData();
        } else {
            elements.loginSection.style.display = 'block';
            elements.dashboardSection.style.display = 'none';
            if (adminMap) { adminMap.remove(); adminMap = null; }
        }
    }

    // --- Event Listeners ---
    elements.loginForm?.addEventListener('submit', handleLogin);
    elements.logoutBtn?.addEventListener('click', handleLogout);
    elements.navTabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    elements.pruneBtn?.addEventListener('click', handlePrune);
    elements.purgeBtn?.addEventListener('click', handlePurge);
    elements.echoSearchInput?.addEventListener('input', () => debounce(fetchAllEchoesForAdmin, 500)());

    // --- Auth ---
    async function handleLogin(e) {
        e.preventDefault();
        elements.loginError.textContent = '';
        try {
            const response = await fetch(`${API_URL}/api/users/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: elements.usernameInput.value, password: elements.passwordInput.value })
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
            elements.loginError.textContent = error.message;
        }
    }
    function handleLogout() {
        localStorage.removeItem('echoes_admin_token');
        adminToken = null;
        updateAdminUI();
    }

    // --- Tab Management ---
    function switchTab(tabId) {
        elements.tabContents.forEach(content => content.classList.remove('active'));
        elements.navTabs.forEach(tab => tab.classList.remove('active'));
        document.getElementById(`${tabId}-view`).classList.add('active');
        document.querySelector(`.nav-tab[data-tab='${tabId}']`).classList.add('active');
        if (tabId === 'echoes' && adminMap) setTimeout(() => adminMap.invalidateSize(), 10);
        if (tabId === 'echoes') fetchAllEchoesForAdmin();
        if (tabId === 'users') fetchAllUsersForAdmin();
    }

    // --- Data Fetching ---
    async function fetchDashboardData() {
        const echoes = await fetchData('/admin/api/echoes');
        const users = await fetchData('/admin/api/users');
        if (echoes) {
            const now = new Date();
            const echoes24h = echoes.filter(e => (now - new Date(e.created_at)) < 24 * 3600 * 1000).length;
            elements.statTotalEchoes.textContent = echoes.length;
            elements.statEchoes24h.textContent = echoes24h;
        }
        if (users) {
            const now = new Date();
            const users24h = users.filter(u => (now - new Date(u.created_at)) < 24 * 3600 * 1000).length;
            elements.statTotalUsers.textContent = users.length;
            elements.statUsers24h.textContent = users24h;
        }
    }
    async function fetchAllEchoesForAdmin() {
        const echoes = await fetchData(`/admin/api/echoes?searchUser=${elements.echoSearchInput.value}`);
        if (echoes) {
            renderEchoesTable(echoes);
            renderEchoesOnAdminMap(echoes);
        }
    }
    async function fetchAllUsersForAdmin() {
        const users = await fetchData('/admin/api/users');
        if (users) renderUsersTable(users);
    }
    async function fetchData(endpoint) {
        if (!adminToken) return null;
        try {
            const response = await fetch(`${API_URL}${endpoint}`, { headers: { 'Authorization': `Bearer ${adminToken}` } });
            if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`);
            return await response.json();
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    // --- Rendering ---
    function renderEchoesTable(echoes) { /* ... same as before ... */ }
    function renderEchoesOnAdminMap(echoes) { /* ... same as before ... */ }
    function renderUsersTable(users) { /* ... same as before ... */ }

    // --- Actions ---
    async function handleDeleteEcho(e) { /* ... same as before ... */ }
    async function handleToggleAdmin(e) { /* ... same as before ... */ }
    async function handlePrune() { /* ... same as before, but update status element ... */ }
    async function handlePurge() { /* ... same as before, but update status element ... */ }

    // --- Map ---
    function initializeAdminMap() {
        if (!adminMapContainer || adminMap) return;
        adminMap = L.map(adminMapContainer).setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(adminMap);
        adminMarkers = L.markerClusterGroup();
        adminMap.addLayer(adminMarkers);
    }
    
    // --- Utils ---
    let debounceTimer;
    function debounce(func, delay) {
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => func.apply(context, args), delay);
        }
    }

    // --- Initial Kickoff ---
    updateAdminUI();

    // (Full function bodies for brevity, replace with your existing correct ones)
    function renderEchoesTable(echoes){if(!elements.echoesTableBody)return;elements.echoesTableBody.innerHTML="";if(0===echoes.length)return void(elements.echoesTableBody.innerHTML='<tr><td colspan="7">No echoes found.</td></tr>');echoes.forEach(echo=>{const e=elements.echoesTableBody.insertRow(),o=parseFloat(echo.lat),t=parseFloat(echo.lng);e.innerHTML=`<td>${echo.id}</td><td>${echo.username||"Anon"}</td><td>${echo.w3w_address}</td><td>${isNaN(o)?"N/A":o.toFixed(4)}</td><td>${isNaN(t)?"N/A":t.toFixed(4)}</td><td>${new Date(echo.created_at).toLocaleString()}</td><td>${echo.play_count}</td><td><audio controls src="${echo.audio_url}"></audio></td><td><button class="delete-echo-btn" data-id="${echo.id}">Delete</button></td>`}),document.querySelectorAll(".delete-echo-btn").forEach(e=>e.addEventListener("click",handleDeleteEcho))}
    function renderEchoesOnAdminMap(echoes){if(!adminMap||!adminMarkers)return;adminMarkers.clearLayers();echoes.forEach(echo=>{const e=parseFloat(echo.lat),o=parseFloat(echo.lng);isNaN(e)||isNaN(o)||(L.marker([e,o]).bindPopup(`<b>ID:</b> ${echo.id}<br><b>Author:</b> ${echo.username||"Anon"}<br><b>Location:</b> ${echo.w3w_address}<br><a href="${echo.audio_url}" target="_blank">Play</a>`).addTo(adminMarkers))})}
    function renderUsersTable(users){if(!elements.usersTableBody)return;elements.usersTableBody.innerHTML="";if(0===users.length)return void(elements.usersTableBody.innerHTML='<tr><td colspan="5">No users found.</td></tr>');users.forEach(user=>{const e=elements.usersTableBody.insertRow();e.innerHTML=`<td>${user.id}</td><td>${user.username}</td><td>${new Date(user.created_at).toLocaleString()}</td><td>${user.is_admin}</td><td><button class="toggle-admin-btn" data-id="${user.id}" data-isadmin="${user.is_admin}">${user.is_admin?"Remove Admin":"Make Admin"}</button></td>`}),document.querySelectorAll(".toggle-admin-btn").forEach(e=>e.addEventListener("click",handleToggleAdmin))}
    async function handleDeleteEcho(e){const o=e.target.dataset.id;if(!confirm(`Delete echo ID ${o}?`))return;try{const t=await fetch(`${API_URL}/admin/api/echoes/${o}`,{method:"DELETE",headers:{Authorization:`Bearer ${adminToken}`}}),n=await t.json();if(!t.ok)throw new Error(n.error||n.msg||"Failed to delete");alert(n.msg||"Echo deleted."),fetchAllEchoesForAdmin()}catch(t){alert(`Error: ${t.message}`)}}
    async function handleToggleAdmin(e){const o=e.target.dataset.id,t="true"===e.target.dataset.isadmin;if(!confirm(`${t?"Remove admin from":"Make admin"} user ID ${o}?`))return;try{const n=await fetch(`${API_URL}/admin/api/users/${o}/toggle-admin`,{method:"PUT",headers:{Authorization:`Bearer ${adminToken}`}}),s=await n.json();if(!n.ok)throw new Error(s.error||"Failed to toggle status");alert("User admin status updated."),fetchAllUsersForAdmin()}catch(n){alert(`Error: ${n.message}`)}}
    async function handlePrune(){if("PRUNE"!==prompt("This is destructive. Type 'PRUNE' to confirm."))return void alert("Pruning cancelled.");elements.pruneStatus.textContent="Pruning...",elements.pruneStatus.className="status",elements.pruneBtn.disabled=!0;try{const e=await fetch(`${API_URL}/admin/api/echoes/prune`,{method:"POST",headers:{Authorization:`Bearer ${adminToken}`}}),o=await e.json();if(!e.ok)throw new Error(o.error||"Pruning failed");elements.pruneStatus.textContent=o.msg,elements.pruneStatus.className="status success"}catch(e){elements.pruneStatus.textContent=`Error: ${e.message}`,elements.pruneStatus.className="status error"}finally{elements.pruneBtn.disabled=!1}}
    async function handlePurge(){if(!confirm("This will permanently delete all unused audio files. Are you sure?"))return;elements.purgeStatus.textContent="Scanning...",elements.purgeStatus.className="status",elements.purgeBtn.disabled=!0;try{const e=await fetch(`${API_URL}/admin/api/storage/purge-orphans`,{method:"POST",headers:{Authorization:`Bearer ${adminToken}`}}),o=await e.json();if(!e.ok)throw new Error(o.error||"Purge failed");elements.purgeStatus.textContent=o.message,elements.purgeStatus.className="status success"}catch(e){elements.purgeStatus.textContent=`Error: ${e.message}`,elements.purgeStatus.className="status error"}finally{elements.purgeBtn.disabled=!1}}
});