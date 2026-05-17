// server/services/achievements.js

const pool = require('../db');

let achievementMap = new Map();

async function loadAchievements() {
    try {
        const result = await pool.query('SELECT id, name FROM achievements');
        achievementMap.clear();
        result.rows.forEach(ach => achievementMap.set(ach.name, ach.id));
        console.log(`[AchievementService] Loaded ${achievementMap.size} achievements into cache.`);
    } catch (error) {
        console.error('[AchievementService] CRITICAL: Failed to load achievements.', error);
    }
}

loadAchievements();

async function grantAchievement(userId, achievementName) {
    const achievementId = achievementMap.get(achievementName);
    if (!achievementId) {
        console.error(`[AchievementService] WARNING: Tried to grant non-existent achievement: '${achievementName}'`);
        return false;
    }
    try {
        const result = await pool.query(
            `INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT (user_id, achievement_id) DO NOTHING`,
            [userId, achievementId]
        );
        if (result.rowCount > 0) {
            console.log(`[AchievementService] 🏆 Awarded '${achievementName}' to user ${userId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[AchievementService] Error granting '${achievementName}':`, error);
        return false;
    }
}

async function checkLeaveEchoAchievements(userId, data) {
    const { newEcho } = data;

    // ── CREATOR — VOLUME ──────────────────────────────────────────────────────
    const { rows: [{ count: rawCount }] } = await pool.query(
        `SELECT COUNT(*) FROM echoes WHERE user_id = $1 AND parent_id IS NULL`, [userId]
    );
    const count = parseInt(rawCount, 10);

    if (count >= 1)    await grantAchievement(userId, 'First Echo');
    if (count >= 5)    await grantAchievement(userId, 'Storyteller');
    if (count >= 25)   await grantAchievement(userId, 'Orator');
    if (count >= 100)  await grantAchievement(userId, 'Historian');
    if (count >= 500)  await grantAchievement(userId, 'Mythmaker');
    if (count >= 1000) await grantAchievement(userId, 'Living Legend');

    // ── CREATOR — CRAFT (duration) ────────────────────────────────────────────
    const dur = newEcho.duration_seconds || 0;
    if (dur > 0 && dur < 3)   await grantAchievement(userId, 'Secret-Keeper');
    if (dur >= 8 && dur <= 17) await grantAchievement(userId, 'Haiku');
    if (dur > 55)  await grantAchievement(userId, 'Monologist');
    if (dur > 120) await grantAchievement(userId, 'The Long Game');
    if (dur > 165) await grantAchievement(userId, 'The Method Actor'); // 2m45s

    // ── CREATOR — RANGE ───────────────────────────────────────────────────────
    if (count > 1 && !newEcho.parent_id && newEcho.geog) {
        const locRes = await pool.query(
            `SELECT geog FROM echoes WHERE user_id = $1 AND id != $2 AND geog IS NOT NULL`,
            [userId, newEcho.id]
        );
        let maxDistance = 0;
        for (const row of locRes.rows) {
            const distRes = await pool.query(
                `SELECT ST_Distance($1::geography, $2::geography)`, [newEcho.geog, row.geog]
            );
            const d = distRes.rows[0].st_distance;
            if (d > maxDistance) maxDistance = d;
        }
        if (maxDistance > 1000)    await grantAchievement(userId, 'Traveler');
        if (maxDistance > 100000)  await grantAchievement(userId, 'Globetrotter');
        if (maxDistance > 1000000) await grantAchievement(userId, 'Voyager');
    }

    // ── CREATOR — TIME ────────────────────────────────────────────────────────
    const echoHour = new Date(newEcho.created_at).getHours();
    const echoDay  = new Date(newEcho.created_at).getDay(); // 0=Sun, 6=Sat

    if (echoHour >= 0 && echoHour < 4) await grantAchievement(userId, 'Night Owl');
    if (echoHour >= 4 && echoHour < 7) await grantAchievement(userId, 'Early Bird');
    if ((echoHour >= 7 && echoHour < 9) || (echoHour >= 17 && echoHour < 19))
        await grantAchievement(userId, 'Rush Hour');
    if (echoHour >= 12 && echoHour < 14) await grantAchievement(userId, 'Lunch Break');
    if (echoDay === 0 || echoDay === 6)  await grantAchievement(userId, 'Weekend Warrior');

    // The Insomniac: 3+ echoes left between 1am–5am (cumulative, any days)
    if (echoHour >= 1 && echoHour < 5) {
        const { rows: [{ count: nightCount }] } = await pool.query(
            `SELECT COUNT(*) FROM echoes WHERE user_id = $1
             AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') >= 1
             AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') < 5`,
            [userId]
        );
        if (parseInt(nightCount) >= 3) await grantAchievement(userId, 'The Insomniac');
    }

    // ── CREATOR — DEDICATION ──────────────────────────────────────────────────
    // Back to Back: 2+ echoes on same calendar day
    const { rows: [{ count: todayCount }] } = await pool.query(
        `SELECT COUNT(*) FROM echoes WHERE user_id = $1 AND DATE(created_at) = DATE(NOW())`,
        [userId]
    );
    if (parseInt(todayCount) >= 2) await grantAchievement(userId, 'Back to Back');

    // Dedicated / Consistent: distinct calendar days with any echo
    const { rows: [{ count: distinctDays }] } = await pool.query(
        `SELECT COUNT(DISTINCT DATE(created_at)) FROM echoes WHERE user_id = $1`,
        [userId]
    );
    const days = parseInt(distinctDays);
    if (days >= 7)  await grantAchievement(userId, 'Dedicated');
    if (days >= 30) await grantAchievement(userId, 'Consistent');

    // ── CREATOR — REPLIES ─────────────────────────────────────────────────────
    if (newEcho.parent_id) {
        const { rows: [{ count: replyCount }] } = await pool.query(
            `SELECT COUNT(*) FROM echoes WHERE user_id = $1 AND parent_id IS NOT NULL`,
            [userId]
        );
        const replies = parseInt(replyCount);
        if (replies >= 3)  await grantAchievement(userId, 'Conversationalist');
        if (replies >= 10) await grantAchievement(userId, 'Pen Pal');
        if (replies >= 25) await grantAchievement(userId, 'Agony Aunt');
    }

    // ── CREATOR — SPATIAL ─────────────────────────────────────────────────────
    // Whispering Gallery: 3 echoes within 50m of each other
    if (count >= 3 && newEcho.geog) {
        const { rows: [{ count: nearbyCount }] } = await pool.query(
            `SELECT COUNT(*) FROM echoes
             WHERE user_id = $1 AND id != $2 AND geog IS NOT NULL
             AND ST_DWithin(geog::geography, $3::geography, 50)`,
            [userId, newEcho.id, newEcho.geog]
        );
        if (parseInt(nearbyCount) >= 2) await grantAchievement(userId, 'Whispering Gallery');
    }
}

async function checkListenEchoAchievements(userId, data) {
    const { listenedEcho } = data;
    const creatorId = listenedEcho.user_id;

    // ── SELF-LISTEN ───────────────────────────────────────────────────────────
    if (userId === creatorId) {
        await grantAchievement(userId, 'Echo Chamber');
        return;
    }

    // ── LISTENER — VOLUME ─────────────────────────────────────────────────────
    await pool.query(
        `INSERT INTO unique_echo_listens (user_id, echo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, listenedEcho.id]
    );
    const { rows: [{ count: rawListens }] } = await pool.query(
        `SELECT COUNT(*) FROM unique_echo_listens WHERE user_id = $1`, [userId]
    );
    const uniqueListens = parseInt(rawListens, 10);

    if (uniqueListens >= 1)    await grantAchievement(userId, 'Explorer');
    if (uniqueListens >= 25)   await grantAchievement(userId, 'Archivist');
    if (uniqueListens >= 100)  await grantAchievement(userId, 'Sage');
    if (uniqueListens >= 250)  await grantAchievement(userId, 'Devotee');
    if (uniqueListens >= 500)  await grantAchievement(userId, 'Pilgrim');
    if (uniqueListens >= 1000) await grantAchievement(userId, 'Oracle');

    // ── LISTENER — MOMENTS ────────────────────────────────────────────────────
    // First ever listener on this echo
    if (listenedEcho.play_count === 1) await grantAchievement(userId, 'Reach Out');

    const echoAgeMs = Date.now() - new Date(listenedEcho.created_at).getTime();
    if (echoAgeMs < 5 * 60 * 1000)    await grantAchievement(userId, 'Fresh Off the Press');
    if (echoAgeMs < 60 * 60 * 1000)   await grantAchievement(userId, 'Heard Afresh');
    if (echoAgeMs > 15 * 24 * 3600 * 1000) await grantAchievement(userId, 'Old Soul');

    // Savior: revive an echo not heard in 15+ days
    if (listenedEcho.last_played_at) {
        const lastPlayedAgeDays = (Date.now() - new Date(listenedEcho.last_played_at).getTime()) / (1000 * 3600 * 24);
        if (lastPlayedAgeDays > 15) await grantAchievement(userId, 'Savior');
    }

    // ── CREATOR AUDIENCE ACHIEVEMENTS ─────────────────────────────────────────
    if (creatorId) {
        const plays = listenedEcho.play_count;
        if (plays >= 100)  await grantAchievement(creatorId, 'Century Club');
        if (plays >= 500)  await grantAchievement(creatorId, 'Hall of Fame');
        if (plays >= 1000) await grantAchievement(creatorId, 'Going Viral');

        // Cult Following: 5 different echoes each with 10+ plays
        if (plays >= 10) {
            const { rows: [{ count: popularEchoes }] } = await pool.query(
                `SELECT COUNT(*) FROM echoes WHERE user_id = $1 AND play_count >= 10`, [creatorId]
            );
            if (parseInt(popularEchoes) >= 5) await grantAchievement(creatorId, 'Cult Following');
        }
    }
}

async function checkReplyReceivedAchievements(userId) {
    await grantAchievement(userId, 'Talked About');

    const { rows: [{ count: rawCount }] } = await pool.query(
        `SELECT COUNT(*) FROM echoes
         WHERE parent_id IN (SELECT id FROM echoes WHERE user_id = $1)`,
        [userId]
    );
    const count = parseInt(rawCount);
    if (count >= 5)  await grantAchievement(userId, 'The Discussable');
    if (count >= 25) await grantAchievement(userId, 'Fan Mail');
}

async function checkWalkCreatedAchievements(userId) {
    await grantAchievement(userId, 'Tour Guide');

    const { rows: [{ count: walkCount }] } = await pool.query(
        `SELECT COUNT(*) FROM walks WHERE user_id = $1`, [userId]
    );
    if (parseInt(walkCount) >= 3) await grantAchievement(userId, 'Trail Blazer');
}

async function checkWalkEchoAddedAchievements(userId, walkId) {
    const { rows: [{ count: echoCount }] } = await pool.query(
        `SELECT COUNT(*) FROM walk_echoes WHERE walk_id = $1`, [walkId]
    );
    if (parseInt(echoCount) >= 5) await grantAchievement(userId, 'Curator');
}

async function checkPlayCompleteAchievements(userId) {
    await grantAchievement(userId, 'The Completionist');
}

async function checkAndAwardAchievements(userId, action, data = {}) {
    if (achievementMap.size === 0) await loadAchievements();
    if (action === 'LEAVE_ECHO') {
        checkLeaveEchoAchievements(userId, data).catch(console.error);
    } else if (action === 'LISTEN_ECHO') {
        checkListenEchoAchievements(userId, data).catch(console.error);
    } else if (action === 'REPLY_RECEIVED') {
        checkReplyReceivedAchievements(userId).catch(console.error);
    } else if (action === 'WALK_CREATED') {
        checkWalkCreatedAchievements(userId).catch(console.error);
    } else if (action === 'WALK_ECHO_ADDED') {
        checkWalkEchoAddedAchievements(userId, data.walkId).catch(console.error);
    } else if (action === 'PLAY_COMPLETE') {
        checkPlayCompleteAchievements(userId).catch(console.error);
    }
}

module.exports = { checkAndAwardAchievements };
