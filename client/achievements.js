// client/achievements.js

const API_URL = 'https://echoes-server.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
    const gridContainer = document.getElementById('achievements-grid-container');
    const loadingMessage = document.getElementById('loading-message');
    const userAuthContainer = document.getElementById('user-auth-container');
    
    const token = localStorage.getItem('echoes_token');

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userAuthContainer.innerHTML = `<span id="welcome-message">${payload.user.username}</span>`;
    } catch (e) {
        localStorage.removeItem('echoes_token');
        window.location.href = 'index.html';
    }

    async function fetchAchievements() {
        try {
            const response = await fetch(`${API_URL}/api/achievements`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error('Could not fetch your achievements.');
            }
            const achievements = await response.json();
            renderAchievements(achievements);
        } catch (error) {
            loadingMessage.textContent = `Error: ${error.message}`;
        }
    }

    function renderAchievements(achievements) {
        gridContainer.innerHTML = ''; // Clear loading message

        if (achievements.length === 0) {
            gridContainer.innerHTML = `<p>No achievements defined yet.</p>`;
            return;
        }

        achievements.forEach(ach => {
            const card = document.createElement('div');
            card.className = 'achievement-card';
            
            const isUnlocked = !!ach.unlocked_at;
            let unlockedDateHtml = '';
            
            if (isUnlocked) {
                const date = new Date(ach.unlocked_at).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric'
                });
                unlockedDateHtml = `<p class="achievement-unlocked-date">Unlocked on ${date}</p>`;
            } else {
                card.classList.add('locked');
            }

            // Use Iconify API for the icons
            const iconUrl = `https://api.iconify.design/${ach.icon}.svg?color=${isUnlocked ? '%2300aaff' : '%23555'}`;

            card.innerHTML = `
                <img class="achievement-icon" src="${iconUrl}" alt="${ach.name}">
                <h3 class="achievement-name">${ach.name}</h3>
                <p class="achievement-description">${ach.description}</p>
                ${unlockedDateHtml}
            `;
            gridContainer.appendChild(card);
        });
    }

    fetchAchievements();
});