// client/my-echoes.js - COMPLETE AND UNABRIDGED

const API_URL = 'https://echoes-server.cheezfish.com';

const EXPIRATION_THRESHOLD_MS = 20 * 24 * 60 * 60 * 1000; 

document.addEventListener('DOMContentLoaded', () => {
    const echoesListContainer = document.getElementById('my-echoes-list-container');
    const loadingMessage = document.getElementById('loading-message');
    const userAuthContainer = document.getElementById('user-auth-container');
    
    const token = localStorage.getItem('echoes_token');

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userAuthContainer.innerHTML = `<span id="welcome-message">Echoes by: ${payload.user.username}</span>`;
    } catch (e) {
        console.error("Failed to decode token", e);
        localStorage.removeItem('echoes_token');
        window.location.href = 'index.html';
    }

    // Helper function to format seconds into MM:SS
    const formatTime = (seconds) => {
        if (seconds === null || isNaN(seconds)) return 'N/A';
        if (seconds === 0) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };
    
    async function fetchMyEchoes() {
        try {
            const response = await fetch(`${API_URL}/api/users/my-echoes`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
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
        echoesListContainer.innerHTML = '';
        if (echoes.length === 0) {
            echoesListContainer.innerHTML = `<p id="empty-message">You haven't left any echoes yet.</p>`;
            return;
        }

        echoes.forEach(echo => {
            const echoItem = document.createElement('div');
            echoItem.className = 'my-echo-item';
            echoItem.dataset.echoId = echo.id;

            const recordedDateTime = new Date(echo.created_at).toLocaleString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true
            });

            const lastPlayedDate = new Date(echo.last_played_at);
            const expiryDate = new Date(lastPlayedDate.getTime() + EXPIRATION_THRESHOLD_MS);
            const expiryDateString = expiryDate.toLocaleDateString('en-US', {
                month: 'long', day: 'numeric'
            });

            const locationDisplayName = echo.location_name || echo.w3w_address;

            echoItem.innerHTML = `
                <div class="info-row">
                    <span class="location-name">${locationDisplayName}</span>
                    <span class="date-info">Recorded: ${recordedDateTime}</span>
                </div>

                <audio controls preload="metadata" src="${echo.audio_url}"></audio>
                
                <div class="stats-row">
                    <span>
                        <img src="https://api.iconify.design/material-symbols:play-circle-outline.svg?color=%23999" alt="Plays">
                        Plays: ${echo.play_count}
                    </span>
                    <span class="duration-display">
                        <img src="https://api.iconify.design/material-symbols:timer-outline.svg?color=%23999" alt="Duration">
                        Duration: ${formatTime(echo.duration_seconds)}
                    </span>
                </div>

                <div class="actions-row">
                    <span>
                        Expires: ${expiryDateString}
                    </span>
                    <button class="delete-btn" data-id="${echo.id}">Delete</button>
                </div>
            `;
            echoesListContainer.appendChild(echoItem);
        });

        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', handleDeleteClick);
        });
    }

    async function handleDeleteClick(event) {
        const button = event.target;
        const echoId = button.dataset.id;
        
        if (!confirm('Are you sure you want to permanently delete this echo?')) return;

        button.textContent = 'Deleting...';
        button.disabled = true;

        try {
            const response = await fetch(`${API_URL}/api/echoes/${echoId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Could not delete echo.');
            }
            const itemToRemove = document.querySelector(`.my-echo-item[data-echo-id='${echoId}']`);
            if (itemToRemove) {
                itemToRemove.style.transition = 'opacity 0.5s ease';
                itemToRemove.style.opacity = '0';
                setTimeout(() => itemToRemove.remove(), 500);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
            button.textContent = 'Delete';
            button.disabled = false;
        }
    }

    fetchMyEchoes();
});