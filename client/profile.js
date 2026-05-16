const API_URL = 'https://echoes-server.cheezfish.com';
const userId = new URLSearchParams(window.location.search).get('id');

async function loadProfile() {
    if (!userId) {
        document.getElementById('profile-not-found').style.display = '';
        document.getElementById('profile-content').style.display = 'none';
        return;
    }
    try {
        const res = await fetch(`${API_URL}/api/users/${userId}/profile`);
        if (!res.ok) {
            document.getElementById('profile-not-found').style.display = '';
            document.getElementById('profile-content').style.display = 'none';
            return;
        }
        const profile = await res.json();
        document.title = `@${profile.username} — Echoes`;
        document.getElementById('profile-username').textContent = `@${profile.username}`;
        renderStats(profile);
        renderEchoes(profile.echoes);
        renderWalks(profile.walks);
    } catch (_) {
        document.getElementById('profile-not-found').style.display = '';
        document.getElementById('profile-content').style.display = 'none';
    }
}

function renderStats(profile) {
    const totalPlays = profile.echoes.reduce((sum, e) => sum + (e.play_count || 0), 0);
    const container = document.getElementById('profile-stats');
    [
        { value: profile.echoes.length, label: 'echo' + (profile.echoes.length !== 1 ? 's' : '') },
        { value: profile.walks.length, label: 'walk' + (profile.walks.length !== 1 ? 's' : '') },
        { value: totalPlays, label: 'play' + (totalPlays !== 1 ? 's' : '') },
    ].forEach(({ value, label }) => {
        const chip = document.createElement('div');
        chip.className = 'stat-chip';
        chip.innerHTML = `<span class="stat-value">${value}</span><span class="stat-label">${label}</span>`;
        container.appendChild(chip);
    });
}

function renderEchoes(echoes) {
    const list = document.getElementById('profile-echoes-list');
    if (!echoes.length) {
        list.innerHTML = '<p class="empty-hint">No echoes yet.</p>';
        return;
    }
    echoes.forEach(echo => {
        const card = document.createElement('div');
        card.className = 'my-echo-item';

        const infoRow = document.createElement('div');
        infoRow.className = 'info-row';
        const loc = document.createElement('span');
        loc.className = 'location-name';
        loc.textContent = echo.location_name || 'Unknown location';
        const date = document.createElement('span');
        date.className = 'echo-date';
        date.textContent = new Date(echo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        infoRow.appendChild(loc);
        infoRow.appendChild(date);
        card.appendChild(infoRow);

        card.appendChild(buildAudioPlayer(echo.audio_url));

        const statsRow = document.createElement('div');
        statsRow.className = 'stats-row';
        statsRow.innerHTML = `<span>▶ ${echo.play_count || 0} plays</span>`;
        if (echo.duration_seconds) {
            const dur = echo.duration_seconds < 60
                ? `${Math.round(echo.duration_seconds)}s`
                : `${Math.floor(echo.duration_seconds / 60)}m ${Math.round(echo.duration_seconds % 60)}s`;
            statsRow.innerHTML += `<span>⏱ ${dur}</span>`;
        }
        card.appendChild(statsRow);

        list.appendChild(card);
    });
}

function renderWalks(walks) {
    if (!walks.length) return;
    document.getElementById('profile-walks-section').style.display = '';
    const list = document.getElementById('profile-walks-list');
    walks.forEach(walk => {
        const card = document.createElement('div');
        card.className = 'my-echo-item profile-walk-card';
        card.innerHTML = `
            <div class="info-row">
                <span class="location-name">${walk.title}</span>
                <span class="echo-date">${walk.echo_count} echo${walk.echo_count !== 1 ? 's' : ''}</span>
            </div>
        `;
        const startBtn = document.createElement('button');
        startBtn.className = 'pill-btn profile-walk-start';
        startBtn.textContent = 'Start Walk →';
        startBtn.addEventListener('click', () => {
            localStorage.setItem('echoes_pending_walk', walk.id);
            window.location.href = 'index.html';
        });
        card.appendChild(startBtn);
        list.appendChild(card);
    });
}

loadProfile();
