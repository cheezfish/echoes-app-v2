// server/services/achievements.js - SKILL TREE UPDATE

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

loadAchievements(); // Load on startup

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
            console.log(`[AchievementService] 🏆 Awarded '${achievementName}' (ID: ${achievementId}) to user ${userId}`);
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

    // --- Creator Path ---
    const echoCountResult = await pool.query('SELECT COUNT(*) FROM echoes WHERE user_id = $1', [userId]);
    const count = parseInt(echoCountResult.rows[0].count, 10);

    if (count >= 1) await grantAchievement(userId, 'First Echo');
    if (count >= 5) await grantAchievement(userId, 'Storyteller');
    if (count >= 25) await grantAchievement(userId, 'Orator');
    if (count >= 100) await grantAchievement(userId, 'Historian');

    if (newEcho.duration_seconds < 3) await grantAchievement(userId, 'Secret-Keeper');
    if (newEcho.duration_seconds > 55) await grantAchievement(userId, 'Monologist');

    // --- Explorer Path ---
    if (count > 1) {
        const locationsResult = await pool.query('SELECT geog FROM echoes WHERE user_id = $1', [userId]);
        const geos = locationsResult.rows.map(r => r.geog);
        let maxDistance = 0;
        if (geos.length > 1) {
            // This is a simplified check, a full NxN check can be slow.
            // A better way is to calculate max distance from the newest point to all others.
            const newGeo = geos[geos.length - 1];
            for (let i = 0; i < geos.length - 1; i++) {
                const distResult = await pool.query('SELECT ST_Distance($1, $2)', [newGeo, geos[i]]);
                const distance = distResult.rows[0].st_distance;
                if (distance > maxDistance) maxDistance = distance;
            }
        }
        if (maxDistance > 1000) await grantAchievement(userId, 'Traveler');
        if (maxDistance > 100000) await grantAchievement(userId, 'Globetrotter');
        if (maxDistance > 1000000) await grantAchievement(userId, 'Voyager');
    }

    // --- Ghost Path ---
    const echoHour = new Date(newEcho.created_at).getHours();
    if (echoHour >= 0 && echoHour < 4) await grantAchievement(userId, 'Night Owl');
    if (echoHour >= 4 && echoHour < 7) await grantAchievement(userId, 'Early Bird');
}

async function checkListenEchoAchievements(userId, data) {
    const { listenedEcho } = data;
    const creatorId = listenedEcho.user_id;

    // --- Ghost Path ---
    if (userId === creatorId) {
        await grantAchievement(userId, 'Echo Chamber');
        return; // Stop here if user is listening to their own echo
    }

    // --- Chronicler Path ---
    await grantAchievement(userId, 'Explorer'); // First listen to another user
    
    // Track unique listen
    await pool.query(
        `INSERT INTO unique_echo_listens (user_id, echo_id) VALUES ($1, $2) ON CONFLICT (user_id, echo_id) DO NOTHING`,
        [userId, listenedEcho.id]
    );

    const listenCountResult = await pool.query('SELECT COUNT(*) FROM unique_echo_listens WHERE user_id = $1', [userId]);
    const uniqueListens = parseInt(listenCountResult.rows[0].count, 10);
    
    if (uniqueListens >= 25) await grantAchievement(userId, 'Archivist');
    if (uniqueListens >= 100) await grantAchievement(userId, 'Sage');

    // Check if they were the first listener (other than the creator)
    if (listenedEcho.play_count === 1) { // The creator's "play" is implicit, so the first real play makes it 2
        await grantAchievement(userId, 'Reach Out');
    }

    // Check age for "Heard Afresh"
    const echoAgeMs = new Date() - new Date(listenedEcho.created_at);
    if (echoAgeMs < 3600 * 1000) await grantAchievement(userId, 'Heard Afresh');
    
    // Check for "Savior"
    const FADING_THRESHOLD_DAYS = 15;
    const lastPlayedAgeDays = (new Date() - new Date(listenedEcho.last_played_at)) / (1000 * 3600 * 24);
    if (lastPlayedAgeDays > FADING_THRESHOLD_DAYS) await grantAchievement(userId, 'Savior');

    // --- Creator Path (For the other user) ---
    if (listenedEcho.play_count >= 100) {
        await grantAchievement(creatorId, 'Century Club');
    }
}

async function checkAndAwardAchievements(userId, action, data = {}) {
    if (achievementMap.size === 0) await loadAchievements();
    console.log(`[AchievementService] Checking achievements for user ${userId}, action: ${action}`);
    if (action === 'LEAVE_ECHO') {
        checkLeaveEchoAchievements(userId, data).catch(console.error);
    } else if (action === 'LISTEN_ECHO') {
        checkListenEchoAchievements(userId, data).catch(console.error);
    }
}

module.exports = { checkAndAwardAchievements };