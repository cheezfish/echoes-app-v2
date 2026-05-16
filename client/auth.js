// client/auth.js — Clerk auth initialisation + shared helpers
// Must be loaded before app.js

const _CLERK_PK = 'pk_test_Z2FtZS1vcnl4LTg5LmNsZXJrLmFjY291bnRzLmRldiQ';
const _API_URL  = 'https://echoes-server.cheezfish.com';

// Shared fetch wrapper that injects the Clerk Bearer token
window.authFetch = async function(url, options = {}) {
    const token = window.Clerk?.session ? await window.Clerk.session.getToken() : null;
    const headers = { ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const { credentials, ...rest } = options; // strip cookie-based auth
    return fetch(url, { ...rest, headers });
};

// Open Clerk's hosted sign-in overlay
window.signIn = function() { window.Clerk?.openSignIn(); };

// Sign out via Clerk, then notify the app
window.signOut = async function() {
    await window.Clerk?.signOut();
};

async function _syncUser() {
    try {
        const res = await window.authFetch(`${_API_URL}/api/users/sync`, { method: 'POST' });
        if (!res.ok) throw new Error(`sync ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error('[auth] sync failed:', err.message);
        return null;
    }
}

async function _initClerk() {
    try {
        await window.Clerk.load({ publishableKey: _CLERK_PK });
    } catch (err) {
        console.error('[auth] Clerk.load failed:', err);
        window.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: null } }));
        return;
    }

    // Fires immediately with current state, then again on changes
    window.Clerk.addListener(async ({ user, session }) => {
        if (user && session) {
            const dbUser = await _syncUser();
            window.clerkUser = dbUser;
            window.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: dbUser } }));
        } else {
            window.clerkUser = null;
            window.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: null } }));
        }
    });
}

// Wait for Clerk CDN script before initialising
if (window.Clerk) {
    _initClerk();
} else {
    document.addEventListener('clerk-js-loaded', _initClerk);
    // Fallback poll in case the custom event doesn't fire
    const _poll = setInterval(() => {
        if (window.Clerk) { clearInterval(_poll); _initClerk(); }
    }, 50);
}
