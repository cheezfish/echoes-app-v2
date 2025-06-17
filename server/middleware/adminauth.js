// server/middleware/adminAuth.js
const jwt = require('jsonwebtoken');
// === HOW IS 'pool' ACCESSED? ===
// Option A: If you have a central db.js that exports the pool
// const pool = require('../db'); // e.g., const { Pool } = require('pg'); const pool = new Pool(...); module.exports = pool;

// Option B: If pool is globally accessible (less common for middleware)
// Or if you pass it via app.locals (more complex to set up)

// For now, let's assume you need to require it from where your server/index.js gets it.
// If your server/index.js does: const { Pool } = require('pg'); const pool = new Pool(...);
// then this middleware needs access to THAT SAME pool.
// The simplest way is if your server/index.js exports the pool,
// OR you adjust this middleware.

// Let's try a direct require for pg and instantiate it if not using a shared pool file.
// THIS IS LIKELY THE PROBLEM IF YOU DON'T HAVE A SHARED db.js
const pool = require('../db'); // Correctly requiring from server/db.js


module.exports = async function(req, res, next) {
    const authHeader = req.header('Authorization');
    if (!authHeader) return res.status(401).json({ msg: 'No token, authorization denied' });

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ msg: 'Token format is "Bearer token"' });
    const token = parts[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user; // This part is fine, user ID is from token

        // === THE CRITICAL DATABASE CHECK ===
        const userResult = await pool.query('SELECT id, username, is_admin FROM users WHERE id = $1', [req.user.id]);
        
        if (userResult.rows.length === 0) {
            console.error(`AdminAuth: User ID ${req.user.id} from token not found in DB.`);
            return res.status(403).json({ msg: 'User not found in database.' });
        }

        const dbUser = userResult.rows[0];
        console.log(`AdminAuth: Checking user from DB:`, dbUser); // Log the user data

        if (!dbUser.is_admin) {
            console.log(`AdminAuth: User ${dbUser.username} (ID: ${dbUser.id}) is_admin flag is: ${dbUser.is_admin}. Denying access.`);
            return res.status(403).json({ msg: 'Access denied: Not an admin' });
        }
        
        console.log(`AdminAuth: User ${dbUser.username} is admin. Allowing access.`);
        next();
    } catch (err) {
        console.error("AdminAuth Error:", err);
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ msg: 'Token is not valid or expired' });
        }
        res.status(500).json({ msg: 'Server error in admin auth' });
    }
};