// client/my-echoes.js - COMPLETE AND UNABRIDGED

const API_URL = 'https://echoes-server.cheezfish.com';

const EXPIRATION_THRESHOLD_MS = 20 * 24 * 60 * 60 * 1000; 

document.addEventListener('DOMContentLoaded', async () => {
    const echoesListContainer = document.getElementById('my-echoes-list-container');
    const loadingMessage = document.getElementById('loading-message');
    const pageNavUser = document.getElementById('page-nav-user');

    // Auth gate — verify session via cookie
    let currentUser;
    try {
        const meRes = await fetch(`${API_URL}/api/users/me`, { credentials: 'include' });
        if (!meRes.ok) { window.location.href = 'index.html'; return; }
        currentUser = await meRes.json();
    } catch {
        window.location.href = 'index.html';
        return;
    }

    if (pageNavUser) pageNavUser.textContent = currentUser.username;

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
                credentials: 'include'
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
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

            // info row
            const infoRow = document.createElement('div');
            infoRow.className = 'info-row';
            const locSpan = document.createElement('span');
            locSpan.className = 'location-name';
            locSpan.textContent = locationDisplayName;
            const dateSpan = document.createElement('span');
            dateSpan.className = 'date-info';
            dateSpan.textContent = `Recorded: ${recordedDateTime}`;
            infoRow.appendChild(locSpan);
            infoRow.appendChild(dateSpan);

            const audio = buildAudioPlayer(echo.audio_url, null);

            // stats row
            const statsRow = document.createElement('div');
            statsRow.className = 'stats-row';
            const playsSpan = document.createElement('span');
            const playsImg = document.createElement('img');
            playsImg.src = 'https://api.iconify.design/material-symbols:play-circle-outline.svg?color=%23999';
            playsImg.alt = 'Plays';
            playsSpan.appendChild(playsImg);
            playsSpan.appendChild(document.createTextNode(` Plays: ${echo.play_count}`));
            const durSpan = document.createElement('span');
            durSpan.className = 'duration-display';
            const durImg = document.createElement('img');
            durImg.src = 'https://api.iconify.design/material-symbols:timer-outline.svg?color=%23999';
            durImg.alt = 'Duration';
            durSpan.appendChild(durImg);
            durSpan.appendChild(document.createTextNode(` Duration: ${formatTime(echo.duration_seconds)}`));
            statsRow.appendChild(playsSpan);
            statsRow.appendChild(durSpan);

            // actions row
            const actionsRow = document.createElement('div');
            actionsRow.className = 'actions-row';
            const expirySpan = document.createElement('span');
            const msUntilExpiry = expiryDate - Date.now();
            const daysLeft = msUntilExpiry / (1000 * 60 * 60 * 24);
            expirySpan.textContent = `Expires: ${expiryDateString}`;
            if (daysLeft < 3) expirySpan.className = 'expiry-urgent';
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.dataset.id = echo.id;
            deleteBtn.textContent = 'Delete';
            actionsRow.appendChild(expirySpan);
            actionsRow.appendChild(deleteBtn);

            echoItem.appendChild(infoRow);
            echoItem.appendChild(audio);
            echoItem.appendChild(statsRow);
            if (echo.transcript && echo.transcript_status === 'done') {
                const details = document.createElement('details');
                details.className = 'echo-transcript';
                const summary = document.createElement('summary');
                summary.textContent = 'Transcript';
                const tp = document.createElement('p');
                tp.textContent = echo.transcript;
                details.appendChild(summary);
                details.appendChild(tp);
                echoItem.appendChild(details);
            }
            echoItem.appendChild(actionsRow);
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
                credentials: 'include'
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