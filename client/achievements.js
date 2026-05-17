// client/achievements.js

const API_URL = 'https://echoes-server.cheezfish.com';

const ACHIEVEMENT_EMOJI = {
    // Creator — Volume
    'First Echo':       '🎙',
    'Storyteller':      '📖',
    'Orator':           '🗣',
    'Historian':        '📚',
    'Mythmaker':        '🗿',
    'Living Legend':    '👑',
    // Creator — Craft
    'Secret-Keeper':    '🤫',
    'Haiku':            '🍃',
    'Monologist':       '🎭',
    'The Long Game':    '⏳',
    'The Method Actor': '🎬',
    // Creator — Range
    'Traveler':         '🗺',
    'Globetrotter':     '🌍',
    'Voyager':          '🚀',
    // Creator — Time
    'Night Owl':        '🦉',
    'Early Bird':       '🌅',
    'Rush Hour':        '🚇',
    'Lunch Break':      '🥪',
    'Weekend Warrior':  '🏖',
    'The Insomniac':    '🌑',
    // Creator — Dedication
    'Back to Back':     '🔁',
    'Dedicated':        '📅',
    'Consistent':       '🗓',
    // Creator — Replies
    'Conversationalist':'💬',
    'Pen Pal':          '✉️',
    'Agony Aunt':       '🫂',
    // Creator — Walks
    'Tour Guide':       '🎯',
    'Curator':          '🗃',
    'Trail Blazer':     '🥾',
    // Creator — Spatial
    'Whispering Gallery':'👂',
    // Listener — Volume
    'Explorer':         '🧭',
    'Archivist':        '🗂',
    'Sage':             '🔮',
    'Devotee':          '🎧',
    'Pilgrim':          '🛤',
    'Oracle':           '🌐',
    // Listener — Moments
    'Reach Out':        '🤝',
    'Fresh Off the Press':'⚡',
    'Heard Afresh':     '✨',
    'Old Soul':         '🕰',
    'Savior':           '💫',
    'The Completionist':'✅',
    // Audience
    'Century Club':     '🏆',
    'Hall of Fame':     '🏛',
    'Going Viral':      '📡',
    'Cult Following':   '👁',
    'Talked About':     '💭',
    'The Discussable':  '🗣',
    'Fan Mail':         '💌',
    // Hidden
    'Echo Chamber':     '🔄',
};

const CATEGORY_ORDER = ['Creator', 'Listener', 'Audience', 'Hidden'];

document.addEventListener('DOMContentLoaded', async () => {
    const gridContainer = document.getElementById('achievements-grid-container');
    const pageNavUser = document.getElementById('page-nav-user');

    const currentUser = await new Promise(resolve => {
        window.addEventListener('auth:ready', e => resolve(e.detail?.user), { once: true });
        if (window.clerkUser !== undefined) resolve(window.clerkUser);
    });
    if (!currentUser) { window.location.href = 'index.html'; return; }
    if (pageNavUser) pageNavUser.textContent = currentUser.username;

    async function fetchAchievements() {
        try {
            const response = await window.authFetch(`${API_URL}/api/achievements`);
            if (!response.ok) throw new Error('Could not fetch achievements.');
            const achievements = await response.json();
            renderAchievements(achievements);
        } catch (error) {
            gridContainer.innerHTML = `<p class="empty-message">${error.message}</p>`;
        }
    }

    function renderAchievements(achievements) {
        gridContainer.innerHTML = '';
        if (!achievements.length) {
            gridContainer.innerHTML = `<p class="empty-message">No achievements defined yet.</p>`;
            return;
        }

        // Group by category, preserving sort_order within each
        const byCategory = {};
        achievements.forEach(ach => {
            const cat = ach.category || 'General';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(ach);
        });

        const orderedCategories = [
            ...CATEGORY_ORDER.filter(c => byCategory[c]),
            ...Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c)),
        ];

        const unlockedCount = achievements.filter(a => a.unlocked_at).length;
        const summary = document.createElement('p');
        summary.className = 'ach-summary';
        summary.textContent = `${unlockedCount} of ${achievements.length} unlocked`;
        gridContainer.appendChild(summary);

        orderedCategories.forEach(cat => {
            const section = document.createElement('div');
            section.className = 'ach-section';

            const label = document.createElement('p');
            label.className = 'section-label';
            label.textContent = cat;
            section.appendChild(label);

            const list = document.createElement('div');
            list.className = 'ach-list glass-card';

            byCategory[cat].forEach((ach, idx) => {
                const isUnlocked = !!ach.unlocked_at;
                const isHidden = cat === 'Hidden' && !isUnlocked;

                const card = document.createElement('div');
                card.className = `achievement-card${isUnlocked ? '' : ' locked'}`;
                if (idx < byCategory[cat].length - 1) card.classList.add('has-border');

                const iconSpan = document.createElement('span');
                iconSpan.className = 'achievement-icon';
                iconSpan.textContent = isHidden ? '?' : (ACHIEVEMENT_EMOJI[ach.name] || '◎');

                const textDiv = document.createElement('div');
                textDiv.className = 'achievement-text';

                const nameEl = document.createElement('div');
                nameEl.className = 'achievement-name';
                nameEl.textContent = isHidden ? '???' : ach.name;

                const descEl = document.createElement('div');
                descEl.className = 'achievement-description';
                descEl.textContent = isHidden ? 'Keep playing to discover this achievement' : ach.description;

                textDiv.appendChild(nameEl);
                textDiv.appendChild(descEl);
                card.appendChild(iconSpan);
                card.appendChild(textDiv);

                if (isUnlocked) {
                    const date = new Date(ach.unlocked_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                    });
                    const dateSpan = document.createElement('span');
                    dateSpan.className = 'achievement-unlocked-date';
                    dateSpan.textContent = date;
                    card.appendChild(dateSpan);
                }

                list.appendChild(card);
            });

            section.appendChild(list);
            gridContainer.appendChild(section);
        });
    }

    fetchAchievements();
});
