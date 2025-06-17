const API_URL = 'https://echoes-server.onrender.com'; // Same API
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginError = document.getElementById('admin-login-error');
const adminLoginSection = document.getElementById('admin-login-section');
const adminDashboardSection = document.getElementById('admin-dashboard-section');
const adminLogoutBtn = document.getElementById('admin-logout-btn');
const echoesTableBody = document.querySelector('#echoes-table tbody');
let adminToken = localStorage.getItem('echoes_admin_token');

function updateAdminUI() {
    if (adminToken) {
        adminLoginSection.style.display = 'none';
        adminDashboardSection.style.display = 'block';
        fetchAllEchoesForAdmin();
    } else {
        adminLoginSection.style.display = 'block';
        adminDashboardSection.style.display = 'none';
    }
}

adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminLoginError.textContent = '';
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;

    try {
        const response = await fetch(`${API_URL}/api/users/login`, { // Use the normal login
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');

        // After successful login, check if user is admin by trying to fetch admin data
        try {
            const adminCheckResponse = await fetch(`${API_URL}/admin/api/echoes`, {
                headers: { 'Authorization': `Bearer ${data.token}` }
            });
            if (!adminCheckResponse.ok) throw new Error('Not an admin or admin data fetch failed.');
            
            localStorage.setItem('echoes_admin_token', data.token);
            adminToken = data.token;
            updateAdminUI();

        } catch (adminCheckError) {
            adminLoginError.textContent = 'Login successful, but you are not authorized for admin access.';
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

async function fetchAllEchoesForAdmin() {
    if (!adminToken) return;
    echoesTableBody.innerHTML = '<tr><td colspan="7">Loading echoes...</td></tr>';
    try {
        const response = await fetch(`${API_URL}/admin/api/echoes`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!response.ok) throw new Error('Failed to fetch echoes');
        const echoes = await response.json();
        renderEchoesTable(echoes);
    } catch (error) {
        echoesTableBody.innerHTML = `<tr><td colspan="7" class="error">${error.message}</td></tr>`;
    }
}

function renderEchoesTable(echoes) {
    echoesTableBody.innerHTML = '';
    if (echoes.length === 0) {
        echoesTableBody.innerHTML = '<tr><td colspan="7">No echoes found.</td></tr>';
        return;
    }
    echoes.forEach(echo => {
        const row = echoesTableBody.insertRow();
        row.innerHTML = `
            <td>${echo.id}</td>
            <td>${echo.username || 'Anonymous'}</td>
            <td>${echo.w3w_address}</td>
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

async function handleDeleteEcho(e) {
    const echoId = e.target.dataset.id;
    if (!confirm(`Are you sure you want to delete echo ID ${echoId}?`)) return;

    try {
        const response = await fetch(`${API_URL}/admin/api/echoes/${echoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete echo');
        }
        alert('Echo deleted successfully.');
        fetchAllEchoesForAdmin(); // Refresh the table
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

// Initial UI setup
updateAdminUI();