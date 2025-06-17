// server/middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    // Get token from the header
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    // Check if it's a Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ msg: 'Token is not valid' });
    }
    const token = parts[1];

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Add user from payload to the request object
        req.user = decoded.user;
        next(); // Move on to the next piece of middleware/route handler
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};