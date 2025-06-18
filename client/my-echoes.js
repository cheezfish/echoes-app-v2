// client/my-echoes.js

const API_URL = 'https://echoes-server.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
    const echoesListContainer = document.getElementById('my-echoes-list-container');
    const loadingMessage = document.getElementById('loading-message');
    const userAuthContainer = document.getElementById('user-auth-container');
    
    const token = localStorage.getItem('echoes_token');

    // Security check: If no token, redirect to the main page.
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    // Display welcome message from token
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userAuthContainer.innerHTML = `<span id="welcome-message">Echoes by: ${payload.user.username}</span>`;
    } catch (e) {
        console.error("Failed to decode token", e);
        // If token is bad, redirect
        localStorage.removeItem('echoes_token');
        window.location.href = 'index.html';
    }


    async function fetchMyEchoes() {
        try {
            const response = await fetch(`${API_URL}/api/users/my-echoes`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                // Handle cases like an expired token
                if (response.status === 401 || response.status === 403) {
                    localStorage.removeItem('echoes_token');
                    window.location.href = 'index.html';
                }
                throw new Error('Could not fetch your echoes.');
            }

            const echoes = await response.json();
            renderEchoes(echoes);

        } catch (error) {
            loadingMessage.textContent = `Error: ${error.message}`;
            loadingMessage.style.color = '#dc3545';
        }
    }

    function renderEchoes(echoes) {
        // Clear the loading message
        echoesListContainer.innerHTML = '';

        if (echoes.length === 0) {
            echoesListContainer.innerHTML = `<p id="empty-message">You haven't left any echoes yet.</p>`;
            return;
        }

        echoes.forEach(echo => {
            const echoItem = document.createElement('div');
            echoItem.className = 'my-echo-item';

            const date = new Date(echo.created_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            echoItem.innerHTML = `
                <div class="info-row">
                    <span class="location-name">${echo.w3w_address || 'Unnamed Location'}</span>
                    <span class="date-info">Recorded on: ${date}</span>
                </div>
                <audio controls preload="none" src="${echo.audio_url}"></audio>
                <div class="info-row">
                    <span>Plays: ${echo.play_count}</span>
                </div>
            `;
            echoesListContainer.appendChild(echoItem);
        });
    }

    fetchMyEchoes();
});