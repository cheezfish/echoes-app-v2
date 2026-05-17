// client/settings.js

const API_URL = 'https://echoes-server.cheezfish.com';

let currentEndpoint = null;
let currentPrefs = null;

window.addEventListener('auth:ready', async ({ detail: { user } }) => {
    if (!user) {
        document.getElementById('account-section').style.display = 'none';
        document.getElementById('auth-gate').style.display = '';
        return;
    }
    document.getElementById('page-nav-user').textContent = user.username || '';
    await initNotificationUI();
    initLocalPrefs();
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────

async function initNotificationUI() {
    const permission = Notification.permission;
    if (permission === 'denied') { showView('denied'); return; }
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            window._pushSub = sub;
            currentEndpoint = sub.endpoint;
            showView('enabled');
            await loadPreferences();
            return;
        }
    }
    showView('disabled');
}

function showView(state) {
    document.getElementById('push-disabled-view').style.display = state === 'disabled' ? '' : 'none';
    document.getElementById('push-enabled-view').style.display  = state === 'enabled'  ? '' : 'none';
    document.getElementById('push-denied-view').style.display   = state === 'denied'   ? '' : 'none';
    document.getElementById('notification-toggles').style.display = state === 'enabled' ? '' : 'none';
}

async function loadPreferences() {
    try {
        const res = await window.authFetch(`${API_URL}/api/push/preferences`);
        currentPrefs = await res.json();
        if (!currentPrefs) return;
        renderToggles(currentPrefs);
    } catch (_) {}
}

function renderToggles(prefs) {
    document.querySelectorAll('.toggle-switch input[type="checkbox"][data-pref]').forEach(input => {
        const key = input.dataset.pref;
        if (key in prefs) input.checked = !!prefs[key];
        input.addEventListener('change', () => onToggleChange(key, input.checked));
    });
}

async function onToggleChange(key, value) {
    if (!currentEndpoint) return;
    currentPrefs = { ...currentPrefs, [key]: value };
    try {
        await window.authFetch(`${API_URL}/api/push/preferences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: currentEndpoint, preferences: { [key]: value } })
        });
    } catch (_) {}
}

document.getElementById('enable-push-btn').addEventListener('click', async () => {
    const btn = document.getElementById('enable-push-btn');
    btn.disabled = true; btn.textContent = 'Enabling…';
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        showView(permission === 'denied' ? 'denied' : 'disabled');
        btn.disabled = false; btn.textContent = 'Enable notifications';
        return;
    }
    const sub = await window.subscribeToPush();
    if (sub) {
        currentEndpoint = sub.endpoint;
        showView('enabled');
        await loadPreferences();
    } else {
        btn.disabled = false; btn.textContent = 'Enable notifications';
    }
});

document.getElementById('disable-push-btn').addEventListener('click', async () => {
    const btn = document.getElementById('disable-push-btn');
    btn.disabled = true; btn.textContent = 'Turning off…';
    await window.unsubscribeFromPush();
    currentEndpoint = null; currentPrefs = null;
    showView('disabled');
    btn.disabled = false; btn.textContent = 'Turn off';
});

// ── LOCAL PREFERENCES ─────────────────────────────────────────────────────────

function initLocalPrefs() {
    // Toggles backed by localStorage
    bindLocalToggle('pref-haptic',         'echoes_haptic',         true);
    bindLocalToggle('pref-transcripts',    'echoes_transcripts',    false);
    bindLocalToggle('pref-skip-preview',   'echoes_skip_preview',   false);
    bindLocalToggle('pref-reduce-motion',  'echoes_reduce_motion',  false);

    // Volume slider
    const volSlider = document.getElementById('pref-volume');
    const volLabel  = document.getElementById('volume-label');
    const storedVol = parseFloat(localStorage.getItem('echoes_volume') ?? '1');
    volSlider.value = Math.round(storedVol * 100);
    volLabel.textContent = `${volSlider.value}%`;
    volSlider.addEventListener('input', () => {
        volLabel.textContent = `${volSlider.value}%`;
        localStorage.setItem('echoes_volume', (volSlider.value / 100).toFixed(2));
    });

    // Segmented controls
    bindSegmented('seg-quality', 'echoes_quality', '64');
    bindSegmented('seg-expiry',  'echoes_expiry',  '14');
    bindSegmented('seg-units',   'echoes_units',   'metric');
}

function bindLocalToggle(id, key, defaultOn) {
    const el = document.getElementById(id);
    if (!el) return;
    const stored = localStorage.getItem(key);
    el.checked = stored !== null ? stored === 'true' : defaultOn;
    el.addEventListener('change', () => {
        localStorage.setItem(key, el.checked ? 'true' : 'false');
        if (key === 'echoes_reduce_motion') {
            document.body.classList.toggle('reduce-motion', el.checked);
        }
    });
}

function bindSegmented(containerId, key, defaultVal) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const current = localStorage.getItem(key) || defaultVal;
    container.querySelectorAll('.seg-btn').forEach(btn => {
        if (btn.dataset.val === current) btn.classList.add('active');
        btn.addEventListener('click', () => {
            container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            localStorage.setItem(key, btn.dataset.val);
        });
    });
}

// ── ACCOUNT ACTIONS ───────────────────────────────────────────────────────────

document.getElementById('manage-account-btn').addEventListener('click', () => {
    if (window.Clerk) window.Clerk.openUserProfile();
});

document.getElementById('export-data-btn').addEventListener('click', async () => {
    const btn = document.getElementById('export-data-btn');
    btn.disabled = true; btn.textContent = 'Exporting…';
    try {
        const res = await window.authFetch(`${API_URL}/api/users/my-echoes`);
        const echoes = await res.json();
        const blob = new Blob([JSON.stringify(echoes, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `echoes-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        btn.textContent = 'Done';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Export'; }, 2000);
    } catch (_) {
        btn.disabled = false; btn.textContent = 'Export';
    }
});

document.getElementById('reset-onboarding-btn').addEventListener('click', () => {
    localStorage.removeItem('echoes_welcomed');
    const btn = document.getElementById('reset-onboarding-btn');
    btn.textContent = 'Done';
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Reset'; }, 2000);
});

// ── DELETE ACCOUNT ────────────────────────────────────────────────────────────

document.getElementById('delete-account-btn').addEventListener('click', () => {
    const modal = document.createElement('div');
    modal.id = 'delete-confirm-modal';
    modal.innerHTML = `
        <div class="delete-modal-box">
            <h3>Delete your account?</h3>
            <p>All your echoes, walks, and recordings will be permanently deleted. This cannot be undone.</p>
            <div class="delete-modal-actions">
                <button id="modal-cancel-btn" class="pill-btn ghost">Cancel</button>
                <button id="modal-confirm-btn" class="pill-btn danger-btn">Delete everything</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('modal-cancel-btn').addEventListener('click', () => modal.remove());
    document.getElementById('modal-confirm-btn').addEventListener('click', async () => {
        const confirmBtn = document.getElementById('modal-confirm-btn');
        confirmBtn.disabled = true; confirmBtn.textContent = 'Deleting…';
        try {
            const res = await window.authFetch(`${API_URL}/api/users/me`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Server error');
            if (window.Clerk) await window.Clerk.signOut();
            window.location.href = '/';
        } catch (_) {
            confirmBtn.disabled = false; confirmBtn.textContent = 'Delete everything';
            const p = modal.querySelector('p');
            p.textContent = 'Something went wrong. Please try again.';
            p.style.color = '#f87171';
        }
    });
});
