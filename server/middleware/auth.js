// server/middleware/auth.js — Clerk-based auth
const { getAuth } = require('@clerk/express');
const pool = require('../db');

module.exports = async function(req, res, next) {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ msg: 'Not authenticated' });

        const result = await pool.query(
            'SELECT id, username FROM users WHERE clerk_id = $1',
            [userId]
        );
        if (!result.rows.length) return res.status(401).json({ msg: 'User not synced — call /api/users/sync first' });

        req.user = result.rows[0];
        next();
    } catch (err) {
        console.error('[Auth] Middleware error:', err.message);
        res.status(401).json({ msg: 'Authentication failed' });
    }
};
