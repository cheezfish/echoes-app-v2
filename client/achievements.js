// client/achievements.js

const API_URL = 'https://echoes-server.cheezfish.com';

document.addEventListener('DOMContentLoaded', async () => {
    const gridContainer = document.getElementById('achievements-grid-container');
    const loadingMessage = document.getElementById('loading-message');
    const userAuthContainer = document.getElementById('user-auth-container');

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

    const span = document.createElement('span');
    span.id = 'welcome-message';
    span.textContent = currentUser.username;
    userAuthContainer.appendChild(span);

    async function fetchAchievements() {
        try {
            const response = await fetch(`${API_URL}/api/achievements`, {
                credentials: 'include'
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
            if (!isUnlocked) card.classList.add('locked');

            const iconUrl = `https://api.iconify.design/${encodeURIComponent(ach.icon)}.svg?color=${isUnlocked ? '%2300aaff' : '%23555'}`;

            const img = document.createElement('img');
            img.className = 'achievement-icon';
            img.src = iconUrl;
            img.alt = ach.name;

            const h3 = document.createElement('h3');
            h3.className = 'achievement-name';
            h3.textContent = ach.name;

            const desc = document.createElement('p');
            desc.className = 'achievement-description';
            desc.textContent = ach.description;

            card.appendChild(img);
            card.appendChild(h3);
            card.appendChild(desc);

            if (isUnlocked) {
                const date = new Date(ach.unlocked_at).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric'
                });
                const dateP = document.createElement('p');
                dateP.className = 'achievement-unlocked-date';
                dateP.textContent = `Unlocked on ${date}`;
                card.appendChild(dateP);
            }

            gridContainer.appendChild(card);
        });
    }

    fetchAchievements();
});