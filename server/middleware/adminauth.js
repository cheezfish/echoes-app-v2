// server/middleware/adminauth.js
// Accepts two auth methods:
// 1. Clerk Bearer token — user must have is_admin=true in DB (primary, for web admin panel)
// 2. Legacy JWT Bearer token — signed with JWT_SECRET, is_admin check (for seeder/CLI tools)
const jwt = require('jsonwebtoken');
const { getAuth } = require('@clerk/express');
const pool = require('../db');

module.exports = async function adminAuthMiddleware(req, res, next) {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ msg: 'Authorization required.' });
    }

    // --- Try Clerk auth first ---
    try {
        const { userId: clerkId } = getAuth(req);
        if (clerkId) {
            const result = await pool.query(
                'SELECT id, username, is_admin FROM users WHERE clerk_id = $1',
                [clerkId]
            );
            if (!result.rows.length) {
                return res.status(401).json({ msg: 'User not synced.' });
            }
            if (!result.rows[0].is_admin) {
                return res.status(403).json({ msg: 'Admin access required.' });
            }
            req.user = result.rows[0];
            return next();
        }
    } catch (_) {}

    // --- Fall back to legacy JWT (seeder / CLI tools) ---
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const result = await pool.query(
            'SELECT id, username, is_admin FROM users WHERE id = $1',
            [decoded.user.id]
        );
        if (!result.rows.length) return res.status(401).json({ msg: 'User not found.' });
        if (!result.rows[0].is_admin) return res.status(403).json({ msg: 'Admin access required.' });
        req.user = result.rows[0];
        return next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ msg: 'Invalid or expired token.' });
        }
        console.error('[AdminAuth]', err.message);
        return res.status(500).json({ msg: 'Server error.' });
    }
};
