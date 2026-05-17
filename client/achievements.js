// client/achievements.js

const API_URL = 'https://echoes-server.cheezfish.com';

const ACHIEVEMENT_EMOJI = {
    'First Echo': '🎙',
    'Storyteller': '📖',
    'Orator': '🗣',
    'Historian': '📚',
    'Secret-Keeper': '🤫',
    'Monologist': '🎭',
    'Traveler': '🗺',
    'Globetrotter': '🌍',
    'Voyager': '🚀',
    'Night Owl': '🦉',
    'Early Bird': '🌅',
    'Echo Chamber': '🔄',
    'Explorer': '🧭',
    'Archivist': '🗂',
    'Sage': '🔮',
    'Reach Out': '🤝',
    'Heard Afresh': '✨',
    'Savior': '💫',
    'Century Club': '🏆',
};

document.addEventListener('DOMContentLoaded', async () => {
    const gridContainer = document.getElementById('achievements-grid-container');
    const loadingMessage = document.getElementById('loading-message');
    const pageNavUser = document.getElementById('page-nav-user');

    // Auth gate — wait for Clerk auth state
    const currentUser = await new Promise(resolve => {
        window.addEventListener('auth:ready', e => resolve(e.detail?.user), { once: true });
        if (window.clerkUser !== undefined) resolve(window.clerkUser);
    });
    if (!currentUser) { window.location.href = 'index.html'; return; }

    if (pageNavUser) pageNavUser.textContent = currentUser.username;

    async function fetchAchievements() {
        try {
            const response = await window.authFetch(`${API_URL}/api/achievements`);

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

            const iconSpan = document.createElement('span');
            iconSpan.className = 'achievement-icon';
            iconSpan.textContent = ACHIEVEMENT_EMOJI[ach.name] || '◎';

            const textDiv = document.createElement('div');
            textDiv.className = 'achievement-text';

            const h3 = document.createElement('h3');
            h3.className = 'achievement-name';
            h3.textContent = ach.name;

            const desc = document.createElement('p');
            desc.className = 'achievement-description';
            desc.textContent = ach.description;

            textDiv.appendChild(h3);
            textDiv.appendChild(desc);

            card.appendChild(iconSpan);
            card.appendChild(textDiv);

            if (isUnlocked) {
                const date = new Date(ach.unlocked_at).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                });
                const dateSpan = document.createElement('span');
                dateSpan.className = 'achievement-unlocked-date';
                dateSpan.textContent = date;
                card.appendChild(dateSpan);
            }

            gridContainer.appendChild(card);
        });
    }

    fetchAchievements();
});
