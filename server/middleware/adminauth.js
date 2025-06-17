// server/middleware/adminAuth.js
const jwt = require('jsonwebtoken');
const pool = require('../db'); // Assuming you'll export 'pool' from a db.js file or pass it in

module.exports = async function(req, res, next) {
    const authHeader = req.header('Authorization');
    if (!authHeader) return res.status(401).json({ msg: 'No token, authorization denied' });

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ msg: 'Token format is "Bearer token"' });
    const token = parts[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;

        // Check if the user is an admin
        const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0 || !userResult.rows[0].is_admin) {
            return res.status(403).json({ msg: 'Access denied: Not an admin' });
        }
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};