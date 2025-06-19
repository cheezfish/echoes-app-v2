// admin-portal/admin.js - FINAL WITH PRUNING FUNCTIONALITY

const API_URL = 'https://echoes-server.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
    const adminLoginForm = document.getElementById('admin-login-form');
    const adminLoginError = document.getElementById('admin-login-error');
    const adminLoginSection = document.getElementById('admin-login-section');
    const adminDashboardSection = document.getElementById('admin-dashboard-section');
    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    const echoesTableBody = document.querySelector('#echoes-table tbody');
    const usersTableBody = document.getElementById('users-table-body');
    const adminMapContainer = document.getElementById('admin-map');
    const seedForm = document.getElementById('seed-echo-form');
    const seedLatInput = document.getElementById('seed-lat');
    const seedLngInput = document.getElementById('seed-lng');
    const seedNameInput = document.getElementById('seed-w3w-address');
    const seedFileInput = document.getElementById('seed-audio-file');
    const seedStatusEl = document.getElementById('seed-status');
    const seedSubmitBtn = document.getElementById('seed-submit-btn');
    const pruneBtn = document.getElementById('prune-echoes-btn');
    const pruneStatusEl = document.getElementById('prune-status');
    const purgeStorageBtn = document.getElementById('purge-storage-btn');       // <-- ADD THIS
const purgeStorageStatusEl = document.getElementById('purge-storage-status'); // <-- ADD THIS

    let adminMap;
    let adminMarkers;
    let locationSelectionMarker;
    let adminToken = localStorage.getItem('echoes_admin_token');

    function updateAdminUI() {
        if (adminToken) {
            adminLoginSection.style.display = 'none';
            adminDashboardSection.style.display = 'block';
            if (!adminMap) initializeAdminMap();
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
                const adminCheckResponse = await fetch(`${API_URL}/admin/api/echoes`, {
                    headers: { 'Authorization': `Bearer ${data.token}` }
                });
                if (adminCheckResponse.status === 403) throw new Error('Not authorized for admin access.');
                if (!adminCheckResponse.ok) throw new Error('Admin verification failed.');
                localStorage.setItem('echoes_admin_token', data.token);
                adminToken = data.token;
                updateAdminUI();
            } catch (error) {
                adminLoginError.textContent = error.message;
            }
        });
    }

    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            localStorage.removeItem('echoes_admin_token');
            adminToken = null;
            updateAdminUI();
        });
    }

    if (pruneBtn) {
        pruneBtn.addEventListener('click', async () => {
            const confirmation = prompt("This is a destructive action. To confirm, type 'PRUNE' in the box below.");
            if (confirmation !== 'PRUNE') {
                alert('Pruning cancelled.');
                return;
            }
            pruneStatusEl.textContent = 'Pruning in progress...';
            pruneStatusEl.className = 'status';
            pruneBtn.disabled = true;
            try {
                const response = await fetch(`${API_URL}/admin/api/echoes/prune`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}` },
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Pruning failed');
                pruneStatusEl.textContent = result.msg;
                pruneStatusEl.className = 'status success';
                fetchAllEchoesForAdmin();
            } catch (error) {
                pruneStatusEl.textContent = `Error: ${error.message}`;
                pruneStatusEl.className = 'status error';
            } finally {
                pruneBtn.disabled = false;
            }
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
        const search = new GeoSearch.GeoSearchControl({
            provider: new GeoSearch.OpenStreetMapProvider(),
            style: 'bar',
            autoClose: true,
            keepResult: true,
        });
        adminMap.addControl(search);
        adminMap.on('click', (e) => updateLocationSelection(e.latlng));
        adminMap.on('geosearch/showlocation', (result) => {
            const latLng = { lat: result.location.y, lng: result.location.x };
            updateLocationSelection(latLng, result.location.label);
        });
    }

    function updateLocationSelection(latLng, label = '') {
        seedLatInput.value = latLng.lat.toFixed(7);
        seedLngInput.value = latLng.lng.toFixed(7);
        if (label && !seedNameInput.value) seedNameInput.value = label.split(',')[0];
        if (locationSelectionMarker) {
            locationSelectionMarker.setLatLng(latLng);
        } else {
            locationSelectionMarker = L.marker(latLng, { draggable: true }).addTo(adminMap);
            locationSelectionMarker.bindPopup("Drag me to adjust location!").openPopup();
            locationSelectionMarker.on('dragend', (e) => {
                const newLatLng = e.target.getLatLng();
                seedLatInput.value = newLatLng.lat.toFixed(7);
                seedLngInput.value = newLatLng.lng.toFixed(7);
            });
        }
        adminMap.panTo(latLng);
    }

    if (seedForm) {
        seedForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            seedStatusEl.textContent = 'Uploading... Please wait.';
            seedStatusEl.className = 'status';
            seedSubmitBtn.disabled = true;
            const formData = new FormData();
            formData.append('lat', seedLatInput.value);
            formData.append('lng', seedLngInput.value);
            formData.append('w3w_address', seedNameInput.value);
            formData.append('audioFile', seedFileInput.files[0]);
            try {
                const response = await fetch(`${API_URL}/admin/api/echoes/seed`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}` },
                    body: formData,
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to create echo.');
                seedStatusEl.textContent = 'Echo seeded successfully!';
                seedStatusEl.className = 'status success';
                seedForm.reset();
                fetchAllEchoesForAdmin();
            } catch (error) {
                seedStatusEl.textContent = `Error: ${error.message}`;
                seedStatusEl.className = 'status error';
            } finally {
                seedSubmitBtn.disabled = false;
            }
        });
    }

    async function fetchAllEchoesForAdmin() {
        if (!adminToken || !echoesTableBody) return;
        echoesTableBody.innerHTML = '<tr><td colspan="9">Loading echoes...</td></tr>';
        if (adminMarkers) adminMarkers.clearLayers();
        try {
            const response = await fetch(`${API_URL}/admin/api/echoes`, {
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
        document.querySelectorAll('.delete-echo-btn').forEach(btn => btn.addEventListener('click', handleDeleteEcho));
    }

    function renderEchoesOnAdminMap(echoes) {
        if (!adminMap || !adminMarkers) return;
        echoes.forEach(echo => {
            const latNum = parseFloat(echo.lat);
            const lngNum = parseFloat(echo.lng);
            if (!isNaN(latNum) && !isNaN(lngNum)) {
                const marker = L.marker([latNum, lngNum]);
                marker.bindPopup(`<b>ID:</b> ${echo.id}<br><b>Author:</b> ${echo.username||"Anon"}<br><b>Location:</b> ${echo.w3w_address}<br><a href="${echo.audio_url}" target="_blank">Play Audio</a>`);
                adminMarkers.addLayer(marker);
            }
        });
    }

    async function handleDeleteEcho(e) {
        const echoId = e.target.dataset.id;
        if (!confirm(`Are you sure you want to delete echo ID ${echoId}? This cannot be undone.`)) return;
        try {
            const response = await fetch(`${API_URL}/admin/api/echoes/${echoId}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || data.msg || 'Failed to delete');
            alert(data.msg || 'Echo deleted successfully.');
            fetchAllEchoesForAdmin();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

        // === ADD THIS NEW EVENT LISTENER FOR THE PURGE BUTTON ===
    if (purgeStorageBtn) {
        purgeStorageBtn.addEventListener('click', async () => {
            // Use a strong confirmation because this is highly destructive
            if (!confirm('This will scan for and permanently delete all unused audio files from your storage bucket. This cannot be undone. Are you sure?')) {
                return;
            }

            purgeStorageStatusEl.textContent = 'Scanning... This may take a minute...';
            purgeStorageStatusEl.className = 'status';
            purgeStorageBtn.disabled = true;

            try {
                const response = await fetch(`${API_URL}/admin/api/storage/purge-orphans`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}` },
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to start purge.');

                purgeStorageStatusEl.textContent = result.message;
                purgeStorageStatusEl.className = 'status success';
            } catch (error) {
                purgeStorageStatusEl.textContent = `Error: ${error.message}`;
                purgeStorageStatusEl.className = 'status error';
            } finally {
                purgeStorageBtn.disabled = false;
            }
        });
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
        document.querySelectorAll('.toggle-admin-btn').forEach(btn => btn.addEventListener('click', handleToggleAdmin));
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
            fetchAllUsersForAdmin();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    updateAdminUI();
});