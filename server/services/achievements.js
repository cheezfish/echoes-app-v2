// server/services/achievements.js - CORRECTED VERSION

const pool = require('../db');

// === NEW: A cache to hold our achievement master list ===
let achievementMap = new Map();

// === NEW: Function to load all achievements into the cache ===
async function loadAchievements() {
    try {
        console.log('[AchievementService] Loading achievement master list...');
        const result = await pool.query('SELECT id, name FROM achievements');
        achievementMap.clear(); // Clear old data
        result.rows.forEach(ach => {
            // We'll use the 'name' column as the key, e.g., 'First Echo'
            achievementMap.set(ach.name, ach.id);
        });
        console.log(`[AchievementService] Loaded ${achievementMap.size} achievements into cache.`);
    } catch (error) {
        console.error('[AchievementService] CRITICAL: Failed to load achievements master list.', error);
    }
}

// Load achievements on startup
loadAchievements();


/**
 * A helper function to grant an achievement if the user doesn't already have it.
 * @param {string} userId - The ID of the user.
 * @param {string} achievementName - The NAME of the achievement (e.g., 'First Echo').
 */
async function grantAchievement(userId, achievementName) {
    // <<< THE FIX IS HERE >>>
    // Get the integer ID from our cached map
    const achievementId = achievementMap.get(achievementName);

    if (!achievementId) {
        console.error(`[AchievementService] WARNING: Tried to grant non-existent achievement named '${achievementName}'`);
        return false;
    }

    try {
        // Now we insert the correct INTEGER ID
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
        console.error(`[AchievementService] Error granting achievement '${achievementName}' to user ${userId}:`, error);
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

    const echoCountResult = await pool.query('SELECT COUNT(*) FROM echoes WHERE user_id = $1', [userId]);
    const count = parseInt(echoCountResult.rows[0].count, 10);

    // Use the correct names from the database seed script
    if (count >= 1) await grantAchievement(userId, 'First Echo');
    // ... Add more tiered achievements here if you define them in the DB ...

    const echoHour = new Date(newEcho.created_at).getHours();
    if (echoHour >= 0 && echoHour < 4) await grantAchievement(userId, 'Night Owl');

    // ... (other checks like Traveler, Early Bird, etc. would go here) ...
}

/**
 * Checks all achievements related to listening to an echo.
 * @param {string} userId - The ID of the user.
 * @param {object} data - Contains info about the listened-to echo.
 */
async function checkListenEchoAchievements(userId, data) {
    const { listenedEcho } = data;

    // This logic needs to be more robust. Let's check if the user has unlocked the "Explorer" achievement.
    // This is a one-time check.
    await grantAchievement(userId, 'Explorer');

    // Logic for Century Club
    if (listenedEcho.play_count >= 100) {
        // The ACHIEVEMENT is for the CREATOR of the echo, not the listener
        await grantAchievement(listenedEcho.user_id, 'Century Club');
    }
}


/**
 * The main exported function. It acts as a router to the specific check functions.
 */
async function checkAndAwardAchievements(userId, action, data = {}) {
    // If the achievement map hasn't loaded for some reason, try again.
    if (achievementMap.size === 0) {
        await loadAchievements();
    }
    
    console.log(`[AchievementService] Checking achievements for user ${userId}, action: ${action}`);
    
    if (action === 'LEAVE_ECHO') {
        checkLeaveEchoAchievements(userId, data).catch(console.error);
    } else if (action === 'LISTEN_ECHO') {
        checkListenEchoAchievements(userId, data).catch(console.error);
    }
}

module.exports = {
    checkAndAwardAchievements,
};