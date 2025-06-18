// server/services/achievements.js

const pool = require('../db'); // Assuming db.js is in the parent directory

/**
 * A helper function to grant an achievement if the user doesn't already have it.
 * @param {string} userId - The ID of the user.
 * @param {string} achievementId - The ID of the achievement (e.g., 'LEAVE_1_ECHO').
 * @returns {Promise<boolean>} - True if a new achievement was awarded, false otherwise.
 */
async function grantAchievement(userId, achievementId) {
    try {
        // The ON CONFLICT clause gracefully handles cases where the user already has the achievement.
        const result = await pool.query(
            `INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT (user_id, achievement_id) DO NOTHING`,
            [userId, achievementId]
        );
        // result.rowCount will be 1 if a new row was inserted, 0 if it already existed.
        if (result.rowCount > 0) {
            console.log(`[AchievementService] 🏆 Awarded '${achievementId}' to user ${userId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[AchievementService] Error granting achievement ${achievementId} to user ${userId}:`, error);
        return false;
    }
}

/**
 * Checks all achievements related to leaving an echo.
 * @param {string} userId - The ID of the user.
 * @param {object} data - Contains info about the new echo.
 */
async function checkLeaveEchoAchievements(userId, data) {
    const { newEcho } = data;

    // --- Check for tiered "leave X echoes" achievements ---
    const echoCountResult = await pool.query('SELECT COUNT(*) FROM echoes WHERE user_id = $1', [userId]);
    const count = parseInt(echoCountResult.rows[0].count, 10);

    if (count >= 1) await grantAchievement(userId, 'LEAVE_1_ECHO');
    if (count >= 5) await grantAchievement(userId, 'LEAVE_5_ECHOES');
    if (count >= 10) await grantAchievement(userId, 'LEAVE_10_ECHOES');
    if (count >= 25) await grantAchievement(userId, 'LEAVE_25_ECHOES');
    if (count >= 50) await grantAchievement(userId, 'LEAVE_50_ECHOES');
    if (count >= 100) await grantAchievement(userId, 'LEAVE_100_ECHOES');
    if (count >= 250) await grantAchievement(userId, 'LEAVE_250_ECHOES');

    // --- Check for traveler achievements ---
    if (count > 1) {
        // Get all echo locations for this user
        const locationsResult = await pool.query('SELECT geog FROM echoes WHERE user_id = $1', [userId]);
        const userGeographies = locationsResult.rows.map(r => r.geog);
        
        // Find the maximum distance between any two of the user's echoes
        let maxDistance = 0;
        for (let i = 0; i < userGeographies.length; i++) {
            for (let j = i + 1; j < userGeographies.length; j++) {
                const distanceResult = await pool.query('SELECT ST_Distance($1, $2)', [userGeographies[i], userGeographies[j]]);
                const distance = distanceResult.rows[0].st_distance;
                if (distance > maxDistance) {
                    maxDistance = distance;
                }
            }
        }
        
        if (maxDistance > 1000) await grantAchievement(userId, 'TRAVELER_1KM');
        if (maxDistance > 10000) await grantAchievement(userId, 'TRAVELER_10KM');
        if (maxDistance > 100000) await grantAchievement(userId, 'TRAVELER_100KM');
        if (maxDistance > 1000000) await grantAchievement(userId, 'TRAVELER_1000KM');
        if (maxDistance > 10000000) await grantAchievement(userId, 'TRAVELER_10000KM');
    }

    // --- Check for special achievements ---
    const echoHour = new Date(newEcho.created_at).getHours();
    if (echoHour >= 0 && echoHour < 4) await grantAchievement(userId, 'NIGHT_OWL');
    if (echoHour >= 4 && echoHour < 7) await grantAchievement(userId, 'EARLY_BIRD');

    if (newEcho.duration_seconds < 3) await grantAchievement(userId, 'SECRET_KEEPER');
    if (newEcho.duration_seconds > 55) await grantAchievement(userId, 'MONOLOGIST');
}

/**
 * Checks all achievements related to listening to an echo.
 * @param {string} userId - The ID of the user.
 * @param {object} data - Contains info about the listened-to echo.
 */
async function checkListenEchoAchievements(userId, data) {
    const { listenedEcho } = data;

    // --- Check for tiered "listen to X echoes" achievements ---
    // Note: This is a simplified check. A true "unique listens" check would require a separate tracking table.
    // For now, we'll base it on the play_count of echoes NOT created by the user.
    const listenCountResult = await pool.query(
        'SELECT SUM(play_count) as total_listens FROM echoes WHERE user_id != $1',
        [userId]
    );
    const count = parseInt(listenCountResult.rows[0].total_listens || 0, 10);

    if (count >= 1) await grantAchievement(userId, 'LISTEN_1_ECHO');
    if (count >= 10) await grantAchievement(userId, 'LISTEN_10_ECHOES');
    if (count >= 25) await grantAchievement(userId, 'LISTEN_25_ECHOES');
    // ... and so on for higher tiers

    // --- Check for special listening achievements ---
    const echoAgeMs = new Date() - new Date(listenedEcho.created_at);
    if (echoAgeMs < 3600 * 1000) { // Less than 1 hour old
        await grantAchievement(userId, 'HEARD_AFRESH');
    }

    const FADING_THRESHOLD_MS = 10 * 24 * 60 * 60 * 1000; // 10 days
    const lastPlayedAgeMs = new Date() - new Date(listenedEcho.last_played_at);
    if (lastPlayedAgeMs > FADING_THRESHOLD_MS) {
        await grantAchievement(userId, 'SAVIOR');
    }
}

/**
 * The main exported function. It acts as a router to the specific check functions.
 */
async function checkAndAwardAchievements(userId, action, data = {}) {
    console.log(`[AchievementService] Checking achievements for user ${userId}, action: ${action}`);
    
    // We run these checks in the background and don't wait for them to complete
    // to avoid slowing down the API response to the user.
    if (action === 'LEAVE_ECHO') {
        checkLeaveEchoAchievements(userId, data).catch(console.error);
    } else if (action === 'LISTEN_ECHO') {
        checkListenEchoAchievements(userId, data).catch(console.error);
    }
}

module.exports = {
    checkAndAwardAchievements,
};