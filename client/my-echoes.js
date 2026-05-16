const API_URL = 'https://echoes-server.cheezfish.com';
const EXPIRATION_THRESHOLD_MS = 20 * 24 * 60 * 60 * 1000;

document.addEventListener('DOMContentLoaded', async () => {
    const echoesListContainer = document.getElementById('my-echoes-list-container');
    const loadingMessage = document.getElementById('loading-message');
    const walksContainer = document.getElementById('my-walks-container');
    const walksList = document.getElementById('walks-list');
    const pageNavUser = document.getElementById('page-nav-user');

    // Auth gate — wait for Clerk auth state
    const currentUser = await new Promise(resolve => {
        window.addEventListener('auth:ready', e => resolve(e.detail?.user), { once: true });
        if (window.clerkUser !== undefined) resolve(window.clerkUser);
    });
    if (!currentUser) { window.location.href = 'index.html'; return; }

    if (pageNavUser) pageNavUser.textContent = currentUser.username;

    const formatTime = (seconds) => {
        if (seconds === null || isNaN(seconds)) return 'N/A';
        if (seconds === 0) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    // ── TABS ──────────────────────────────────────────────────────────────────

    let walksLoaded = false;

    document.querySelectorAll('.page-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.page-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            echoesListContainer.style.display = tab === 'echoes' ? '' : 'none';
            walksContainer.style.display = tab === 'walks' ? '' : 'none';
            if (tab === 'walks' && !walksLoaded) {
                walksLoaded = true;
                fetchMyWalks();
            }
        });
    });

    // ── ECHOES ────────────────────────────────────────────────────────────────

    async function fetchMyEchoes() {
        try {
            const response = await window.authFetch(`${API_URL}/api/users/my-echoes`);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) window.location.href = 'index.html';
                throw new Error('Could not fetch your echoes.');
            }
            renderEchoes(await response.json());
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
            const expiryDateString = expiryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

            const locationDisplayName = echo.parent_id
                ? `↩ Reply · ${echo.parent_location_name || echo.location_name || 'an echo'}`
                : (echo.location_name || echo.w3w_address);

            // info row
            const infoRow = document.createElement('div');
            infoRow.className = 'info-row';
            const locSpan = document.createElement('span');
            locSpan.className = 'location-name';
            if (echo.parent_id) locSpan.classList.add('is-reply');
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

            // transcript
            if (echo.transcript && echo.transcript_status === 'done') {
                const details = document.createElement('details');
                details.className = 'echo-transcript';
                const summary = document.createElement('summary');
                summary.textContent = 'Transcript';
                const tp = document.createElement('p');
                tp.textContent = echo.transcript;
                details.appendChild(summary);
                details.appendChild(tp);
                echoItem.appendChild(infoRow);
                echoItem.appendChild(audio);
                echoItem.appendChild(statsRow);
                echoItem.appendChild(details);
            } else {
                echoItem.appendChild(infoRow);
                echoItem.appendChild(audio);
                echoItem.appendChild(statsRow);
            }

            // actions row
            const actionsRow = document.createElement('div');
            actionsRow.className = 'actions-row';
            const expirySpan = document.createElement('span');
            const msUntilExpiry = expiryDate - Date.now();
            const daysLeft = msUntilExpiry / (1000 * 60 * 60 * 24);
            expirySpan.textContent = `Expires: ${expiryDateString}`;
            if (daysLeft < 3) expirySpan.className = 'expiry-urgent';

            // Add to Walk button
            const addToWalkBtn = document.createElement('button');
            addToWalkBtn.className = 'add-to-walk-btn';
            addToWalkBtn.textContent = '+ Walk';
            addToWalkBtn.title = 'Add to a walk';
            addToWalkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAddToWalkMenu(echo.id, addToWalkBtn);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.dataset.id = echo.id;
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', handleDeleteClick);

            actionsRow.appendChild(expirySpan);
            actionsRow.appendChild(addToWalkBtn);
            actionsRow.appendChild(deleteBtn);
            echoItem.appendChild(actionsRow);

            echoesListContainer.appendChild(echoItem);
        });
    }

    async function handleDeleteClick(event) {
        const button = event.target;
        const echoId = button.dataset.id;
        if (!confirm('Are you sure you want to permanently delete this echo?')) return;
        button.textContent = 'Deleting...';
        button.disabled = true;
        try {
            const response = await window.authFetch(`${API_URL}/api/echoes/${echoId}`, {
                method: 'DELETE',
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

    // ── ADD TO WALK MENU ──────────────────────────────────────────────────────

    let cachedWalks = null;

    async function openAddToWalkMenu(echoId, anchorBtn) {
        // Remove any existing menus
        document.querySelectorAll('.walk-select-menu').forEach(m => m.remove());

        if (!cachedWalks) {
            try {
                const res = await fetch(`${API_URL}/api/walks/mine`, { credentials: 'include' });
                cachedWalks = await res.json();
            } catch { cachedWalks = []; }
        }

        const menu = document.createElement('div');
        menu.className = 'walk-select-menu';

        if (cachedWalks.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'No walks yet.';
            menu.appendChild(empty);
        } else {
            cachedWalks.forEach(walk => {
                const item = document.createElement('button');
                item.textContent = walk.title;
                item.addEventListener('click', async () => {
                    menu.remove();
                    try {
                        const res = await fetch(`${API_URL}/api/walks/${walk.id}/echoes`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ echo_id: echoId })
                        });
                        if (!res.ok) throw new Error('Failed');
                        anchorBtn.textContent = '✓ Added';
                        setTimeout(() => { anchorBtn.textContent = '+ Walk'; }, 2000);
                    } catch { alert('Could not add echo to walk.'); }
                });
                menu.appendChild(item);
            });
        }

        const newWalkItem = document.createElement('button');
        newWalkItem.className = 'new-walk-from-echo';
        newWalkItem.textContent = '+ New Walk';
        newWalkItem.addEventListener('click', async () => {
            menu.remove();
            const title = prompt('Walk name:');
            if (!title?.trim()) return;
            try {
                const wRes = await fetch(`${API_URL}/api/walks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ title: title.trim() })
                });
                const newWalk = await wRes.json();
                cachedWalks = null; // invalidate cache
                await fetch(`${API_URL}/api/walks/${newWalk.id}/echoes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ echo_id: echoId })
                });
                anchorBtn.textContent = '✓ Added';
                setTimeout(() => { anchorBtn.textContent = '+ Walk'; }, 2000);
            } catch { alert('Could not create walk.'); }
        });
        menu.appendChild(newWalkItem);

        anchorBtn.parentElement.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target) && e.target !== anchorBtn) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    // ── WALKS ─────────────────────────────────────────────────────────────────

    async function fetchMyWalks() {
        walksList.innerHTML = '<p id="walks-loading-message">Loading your walks...</p>';
        try {
            const res = await fetch(`${API_URL}/api/walks/mine`, { credentials: 'include' });
            if (!res.ok) throw new Error('Could not fetch walks.');
            cachedWalks = await res.json();
            renderWalks(cachedWalks);
        } catch (error) {
            walksList.innerHTML = `<p style="color:#dc3545;text-align:center;padding:2rem 0">Error: ${error.message}</p>`;
        }
    }

    function renderWalks(walks) {
        walksList.innerHTML = '';
        if (walks.length === 0) {
            walksList.innerHTML = `<p style="text-align:center;color:rgba(255,255,255,0.3);padding:3rem 0">No walks yet. Create one and add your echoes.</p>`;
            return;
        }
        walks.forEach(walk => walksList.appendChild(buildWalkCard(walk)));
    }

    function buildWalkCard(walk) {
        const card = document.createElement('div');
        card.className = 'walk-card';
        card.dataset.walkId = walk.id;

        const header = document.createElement('div');
        header.className = 'walk-card-header';

        const titleEl = document.createElement('span');
        titleEl.className = 'walk-title';
        titleEl.textContent = walk.title;

        const meta = document.createElement('span');
        meta.className = 'walk-meta';
        meta.textContent = `${walk.echo_count} echo${walk.echo_count !== 1 ? 's' : ''}`;

        const actions = document.createElement('span');
        actions.className = 'walk-header-actions';

        const expandBtn = document.createElement('button');
        expandBtn.className = 'walk-expand-btn';
        expandBtn.textContent = 'View';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(`Delete walk "${walk.title}"?`)) return;
            try {
                const res = await fetch(`${API_URL}/api/walks/${walk.id}`, {
                    method: 'DELETE', credentials: 'include'
                });
                if (!res.ok) throw new Error('Failed');
                cachedWalks = null;
                card.style.transition = 'opacity 0.4s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 400);
            } catch { alert('Could not delete walk.'); }
        });

        actions.appendChild(expandBtn);
        actions.appendChild(deleteBtn);
        header.appendChild(titleEl);
        header.appendChild(meta);
        header.appendChild(actions);
        card.appendChild(header);

        const echoListEl = document.createElement('div');
        echoListEl.className = 'walk-echo-list';
        echoListEl.style.display = 'none';
        card.appendChild(echoListEl);

        let expanded = false;
        expandBtn.addEventListener('click', async () => {
            expanded = !expanded;
            expandBtn.textContent = expanded ? 'Hide' : 'View';
            echoListEl.style.display = expanded ? '' : 'none';
            if (expanded && echoListEl.children.length === 0) {
                echoListEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:0.8rem">Loading…</p>';
                try {
                    const res = await fetch(`${API_URL}/api/walks/${walk.id}`, { credentials: 'include' });
                    const data = await res.json();
                    echoListEl.innerHTML = '';
                    if (data.echoes.length === 0) {
                        echoListEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:0.8rem;padding:0.5rem 0">No echoes in this walk yet.</p>';
                    } else {
                        data.echoes.forEach(e => echoListEl.appendChild(buildWalkEchoRow(e, walk.id)));
                    }
                } catch {
                    echoListEl.innerHTML = '<p style="color:#dc3545;font-size:0.8rem">Could not load echoes.</p>';
                }
            }
        });

        return card;
    }

    function buildWalkEchoRow(echo, walkId) {
        const row = document.createElement('div');
        row.className = 'walk-echo-row';
        row.dataset.echoId = echo.echo_id;

        const num = document.createElement('span');
        num.className = 'walk-echo-num';
        num.textContent = echo.position + 1;

        const info = document.createElement('div');
        info.className = 'walk-echo-info';
        const name = document.createElement('span');
        name.className = 'walk-echo-name';
        name.textContent = echo.location_name || 'Unnamed';
        const player = buildAudioPlayer(echo.audio_url, null);
        info.appendChild(name);
        info.appendChild(player);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'walk-echo-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from walk';
        removeBtn.addEventListener('click', async () => {
            try {
                await fetch(`${API_URL}/api/walks/${walkId}/echoes/${echo.echo_id}`, {
                    method: 'DELETE', credentials: 'include'
                });
                cachedWalks = null;
                row.style.transition = 'opacity 0.3s';
                row.style.opacity = '0';
                setTimeout(() => {
                    row.remove();
                    // Re-number remaining rows
                    row.parentElement?.querySelectorAll('.walk-echo-num').forEach((n, i) => { n.textContent = i + 1; });
                }, 300);
            } catch { alert('Could not remove echo from walk.'); }
        });

        row.appendChild(num);
        row.appendChild(info);
        row.appendChild(removeBtn);
        return row;
    }

    // ── NEW WALK FORM ─────────────────────────────────────────────────────────

    document.getElementById('new-walk-btn').addEventListener('click', () => {
        document.getElementById('new-walk-form').style.display = 'flex';
        document.getElementById('new-walk-btn').style.display = 'none';
        document.getElementById('walk-title-input').focus();
    });

    document.getElementById('cancel-walk-btn').addEventListener('click', () => {
        document.getElementById('new-walk-form').style.display = 'none';
        document.getElementById('new-walk-btn').style.display = '';
        document.getElementById('walk-title-input').value = '';
    });

    document.getElementById('create-walk-btn').addEventListener('click', async () => {
        const title = document.getElementById('walk-title-input').value.trim();
        if (!title) return;
        try {
            const res = await fetch(`${API_URL}/api/walks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ title })
            });
            if (!res.ok) throw new Error('Failed to create walk.');
            const newWalk = await res.json();
            cachedWalks = null;
            document.getElementById('new-walk-form').style.display = 'none';
            document.getElementById('new-walk-btn').style.display = '';
            document.getElementById('walk-title-input').value = '';
            // Prepend new walk card
            const card = buildWalkCard(newWalk);
            walksList.querySelector('p')?.remove();
            walksList.prepend(card);
        } catch (err) { alert(err.message); }
    });

    fetchMyEchoes();
});
