// client/settings.js — notification settings page

const API_URL = 'https://echoes-server.cheezfish.com';

let currentEndpoint = null;
let currentPrefs = null;

window.addEventListener('auth:ready', async ({ detail: { user } }) => {
    if (!user) {
        document.getElementById('settings-content').style.display = 'none';
        document.getElementById('account-section').style.display = 'none';
        document.getElementById('auth-gate').style.display = '';
        return;
    }
    await initNotificationUI();
});

async function initNotificationUI() {
    const permission = Notification.permission;

    if (permission === 'denied') {
        showView('denied');
        return;
    }

    // Check if already subscribed
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
    document.getElementById('push-enabled-view').style.display = state === 'enabled' ? '' : 'none';
    document.getElementById('push-denied-view').style.display = state === 'denied' ? '' : 'none';
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
    document.querySelectorAll('.toggle-switch input[type="checkbox"]').forEach(input => {
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
    btn.disabled = true;
    btn.textContent = 'Enabling…';

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        showView(permission === 'denied' ? 'denied' : 'disabled');
        btn.disabled = false;
        btn.textContent = 'Enable notifications';
        return;
    }

    const sub = await window.subscribeToPush();
    if (sub) {
        currentEndpoint = sub.endpoint;
        showView('enabled');
        // Load default prefs freshly from server
        await loadPreferences();
    } else {
        btn.disabled = false;
        btn.textContent = 'Enable notifications';
    }
});

document.getElementById('disable-push-btn').addEventListener('click', async () => {
    const btn = document.getElementById('disable-push-btn');
    btn.disabled = true;
    btn.textContent = 'Turning off…';
    await window.unsubscribeFromPush();
    currentEndpoint = null;
    currentPrefs = null;
    showView('disabled');
    btn.disabled = false;
    btn.textContent = 'Turn off';
});

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
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting…';
        try {
            const res = await window.authFetch(`${API_URL}/api/users/me`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Server error');
            // Sign out of Clerk then redirect to home
            if (window.Clerk) await window.Clerk.signOut();
            window.location.href = '/';
        } catch (_) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete everything';
            const p = modal.querySelector('p');
            p.textContent = 'Something went wrong. Please try again.';
            p.style.color = '#f87171';
        }
    });
});
