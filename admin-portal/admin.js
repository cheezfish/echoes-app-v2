// admin-portal/admin.js - BULLETPROOF LOGIN

const API_URL = 'https://echoes-server.onrender.com';

// Wait for the DOM to be fully loaded before trying to access elements
document.addEventListener('DOMContentLoaded', () => {
    const adminLoginForm = document.getElementById('admin-login-form');
    const adminLoginError = document.getElementById('admin-login-error');
    const adminLoginSection = document.getElementById('admin-login-section');
    const adminDashboardSection = document.getElementById('admin-dashboard-section');
    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    const echoesTableBody = document.querySelector('#echoes-table tbody');
    const usersTableBody = document.getElementById('users-table-body');
    const adminMapContainer = document.getElementById('admin-map');
    
    let adminMap;
    let adminMarkers;
    let adminToken = localStorage.getItem('echoes_admin_token');

    function updateAdminUI() {
        if (adminToken) {
            adminLoginSection.style.display = 'none';
            adminDashboardSection.style.display = 'block';
            if (!adminMap) initializeAdminMap(); // Initialize map only if it doesn't exist
            fetchAllEchoesForAdmin();
            fetchAllUsersForAdmin();
        } else {
            adminLoginSection.style.display = 'block';
            adminDashboardSection.style.display = 'none';
            if (adminMap) {
                adminMap.remove();
                adminMap = null;
            }
        }
    }

    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // <<< CRITICAL: PREVENT DEFAULT FORM SUBMISSION
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

                // Verify admin status by trying to fetch admin-only data
                try {
                    const adminCheckResponse = await fetch(`${API_URL}/admin/api/echoes`, { // Or /admin/api/users
                        headers: { 'Authorization': `Bearer ${data.token}` }
                    });
                    if (adminCheckResponse.status === 403) throw new Error('Not authorized for admin access.');
                    if (!adminCheckResponse.ok) throw new Error('Admin verification failed.');
                    
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
    } else {
        console.error("Admin login form not found!");
    }

    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            localStorage.removeItem('echoes_admin_token');
            adminToken = null;
            updateAdminUI();
        });
    }

    function initializeAdminMap() {
        if (!adminMapContainer || adminMap) return;
        adminMap = L.map(adminMapContainer).setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(adminMap);
        adminMarkers = L.markerClusterGroup();
        adminMap.addLayer(adminMarkers);
    }

    async function fetchAllEchoesForAdmin() {
        if (!adminToken || !echoesTableBody) return;
        echoesTableBody.innerHTML = '<tr><td colspan="9">Loading echoes...</td></tr>';
        if (adminMarkers) adminMarkers.clearLayers();
        try {
            const searchUserInput = document.getElementById('search-user-input'); // Assuming you add these later
            const searchLocationInput = document.getElementById('search-location-input');
            let query = '';
            if (searchUserInput && searchUserInput.value) query += `&searchUser=${encodeURIComponent(searchUserInput.value)}`;
            if (searchLocationInput && searchLocationInput.value) query += `&searchLocation=${encodeURIComponent(searchLocationInput.value)}`;
            
            const response = await fetch(`${API_URL}/admin/api/echoes?${query.substring(1)}`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (!response.ok) throw new Error('Failed to fetch echoes');
            const echoes = await response.json();
            renderEchoesTable(echoes);
            renderEchoesOnAdminMap(echoes);
        } catch (error) {
            echoesTableBody.innerHTML = `<tr><td colspan="9" class="error">${error.message}</td></tr>`;
        }
    }

    function renderEchoesTable(echoes) {
        if (!echoesTableBody) return;
        echoesTableBody.innerHTML = '';
        if (echoes.length === 0) {
            echoesTableBody.innerHTML = '<tr><td colspan="9">No echoes found.</td></tr>';
            return;
        }
        echoes.forEach(echo => {
            const row = echoesTableBody.insertRow();
            const latNum = parseFloat(echo.lat);
            const lngNum = parseFloat(echo.lng);
            row.innerHTML = `<td>${echo.id}</td><td>${echo.username||"Anon"}</td><td>${echo.w3w_address}</td><td>${!isNaN(latNum)?latNum.toFixed(4):"N/A"}</td><td>${!isNaN(lngNum)?lngNum.toFixed(4):"N/A"}</td><td>${new Date(echo.created_at).toLocaleString()}</td><td>${echo.play_count}</td><td><audio controls src="${echo.audio_url}"></audio></td><td><button class="delete-echo-btn" data-id="${echo.id}">Delete</button></td>`;
        });
        document.querySelectorAll('.delete-echo-btn').forEach(btn => {
            btn.addEventListener('click', handleDeleteEcho);
        });
    }

    function renderEchoesOnAdminMap(echoes) {
        if (!adminMap || !adminMarkers) return;
        echoes.forEach(echo => {
            const latNum = parseFloat(echo.lat);
            const lngNum = parseFloat(echo.lng);
            if (!isNaN(latNum) && !isNaN(lngNum)) {
                const marker = L.marker([latNum, lngNum]);
                marker.bindPopup(`<b>ID:</b> ${echo.id}<br><b>Author:</b> ${echo.username||"Anon"}<br><b>Location:</b> ${echo.w3w_address}<br><a href="${echo.audio_url}" target="_blank">Play</a>`);
                adminMarkers.addLayer(marker);
            }
        });
    }

    async function handleDeleteEcho(e) {
        const echoId = e.target.dataset.id;
        if (!confirm(`Delete echo ID ${echoId}?`)) return;
        try {
            const response = await fetch(`${API_URL}/admin/api/echoes/${echoId}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || data.msg || 'Failed to delete');
            alert(data.msg || 'Echo deleted.');
            fetchAllEchoesForAdmin();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    async function fetchAllUsersForAdmin() {
        if (!adminToken || !usersTableBody) return;
        usersTableBody.innerHTML = '<tr><td colspan="5">Loading users...</td></tr>';
        try {
            const response = await fetch(`${API_URL}/admin/api/users`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            if (!response.ok) throw new Error('Failed to fetch users');
            const users = await response.json();
            renderUsersTable(users);
        } catch (error) {
            usersTableBody.innerHTML = `<tr><td colspan="5" class="error">${error.message}</td></tr>`;
        }
    }

    function renderUsersTable(users) {
        if (!usersTableBody) return;
        usersTableBody.innerHTML = '';
        if (users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="5">No users found.</td></tr>';
            return;
        }
        users.forEach(user => {
            const row = usersTableBody.insertRow();
            row.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${new Date(user.created_at).toLocaleString()}</td><td>${user.is_admin}</td><td><button class="toggle-admin-btn" data-id="${user.id}" data-isadmin="${user.is_admin}">${user.is_admin ? "Remove Admin" : "Make Admin"}</button></td>`;
        });
        document.querySelectorAll('.toggle-admin-btn').forEach(btn => {
            btn.addEventListener('click', handleToggleAdmin);
        });
    }

    async function handleToggleAdmin(e) {
        const userId = e.target.dataset.id;
        const currentIsAdmin = e.target.dataset.isadmin === 'true';
        if (!confirm(`${currentIsAdmin ? "Remove admin from" : "Make admin"} user ID ${userId}?`)) return;
        try {
            const response = await fetch(`${API_URL}/admin/api/users/${userId}/toggle-admin`, {
                method: 'PUT', headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to toggle admin status');
            alert(`User admin status updated.`);
            fetchAllUsersForAdmin(); // Refresh users table
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    updateAdminUI(); // Initial check
});