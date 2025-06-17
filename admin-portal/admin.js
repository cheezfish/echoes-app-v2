// server/index.js - COWABUNGA POLISH (BACKEND - FULL VERSION)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Keep this if pool is defined here
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Use the shared pool from db.js
const pool = require('./db'); 
const authMiddleware = require('./middleware/auth');
const adminAuthMiddleware = require('./middleware/adminAuth');

const app = express();
app.use(cors());
app.use(express.json());

// --- USER AUTH ROUTES ---
app.post('/api/users/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const newUserQuery = 'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username;';
        const result = await pool.query(newUserQuery, [username, password_hash]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') { // Unique constraint violation
            return res.status(409).json({ error: 'Username already exists.' });
        }
        console.error("Registration DB Error:", err);
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    try {
        const userQuery = 'SELECT * FROM users WHERE username = $1;';
        const result = await pool.query(userQuery, [username]);
        const user = result.rows[0];
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const payload = { user: { id: user.id, username: user.username } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            res.json({ token });
        });
    } catch (err) {
        console.error("Login DB Error:", err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});

// --- MAIN APP ECHOES ROUTES ---
app.get('/echoes', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: "Latitude and longitude are required." });
    }
    try {
        const query = `
            SELECT e.*, u.username 
            FROM echoes e 
            LEFT JOIN users u ON e.user_id = u.id 
            WHERE ST_DWithin(e.geog, ST_MakePoint($2, $1)::geography, 100) 
            AND e.last_played_at > NOW() - INTERVAL '30 days'
            ORDER BY e.created_at DESC;
        `;
        const result = await pool.query(query, [lat, lng]);
        res.json(result.rows);
    } catch (err) {
        console.error("Get Echoes DB Error:", err);
        res.status(500).send('Server Error');
    }
});

app.post('/echoes', authMiddleware, async (req, res) => {
    const { w3w_address, audio_url, lat, lng } = req.body;
    const user_id = req.user.id;
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, geog, play_count, last_played_at) 
            VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($4, $3), 4326), 1, CURRENT_TIMESTAMP) 
            RETURNING id;
        `; // Initialize play_count and last_played_at
        const insertValues = [w3w_address, audio_url, lat, lng, user_id];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;

        const finalQuery = `
            SELECT e.*, u.username 
            FROM echoes e LEFT JOIN users u ON e.user_id = u.id 
            WHERE e.id = $1;
        `;
        const finalResult = await pool.query(finalQuery, [newEchoId]);
        res.status(201).json(finalResult.rows[0]);
    } catch (err) {
        console.error('Create Echo DB Error:', err);
        res.status(500).json({ error: 'Failed to save echo to database.' });
    }
});

app.post('/api/echoes/:id/play', async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            UPDATE echoes SET last_played_at = CURRENT_TIMESTAMP, play_count = play_count + 1
            WHERE id = $1 RETURNING id, play_count, last_played_at;
        `;
        const result = await pool.query(query, [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Echo not found." });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating play count for echo ${id}:`, err);
        res.status(500).send("Server Error");
    }
});

app.post('/presigned-url', async (req, res) => {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) return res.status(400).json({ error: 'fileName and fileType are required' });
    const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });
    const putCommand = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileName, ContentType: fileType });
    try {
        const signedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 60 });
        res.json({ url: signedUrl });
    } catch (err) {
        console.error("Error creating presigned URL:", err);
        res.status(500).send('Server Error');
    }
});


// === ADMIN API ROUTES ===
app.get('/admin/api/echoes', adminAuthMiddleware, async (req, res) => {
    const { searchUser, searchLocation } = req.query;
    let queryParams = [];
    let baseQuery = `
        SELECT e.*, u.username 
        FROM echoes e
        LEFT JOIN users u ON e.user_id = u.id 
    `;
    let whereClauses = [];
    if (searchUser) {
        queryParams.push(`%${searchUser}%`);
        whereClauses.push(`u.username ILIKE $${queryParams.length}`);
    }
    if (searchLocation) {
        queryParams.push(`%${searchLocation}%`);
        whereClauses.push(`e.w3w_address ILIKE $${queryParams.length}`);
    }
    if (whereClauses.length > 0) {
        baseQuery += " WHERE " + whereClauses.join(" AND ");
    }
    baseQuery += " ORDER BY e.created_at DESC;";
    try {
        const result = await pool.query(baseQuery, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin: Error fetching all echoes:', err);
        res.status(500).send('Server Error');
    }
});

app.delete('/admin/api/echoes/:id', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const getEchoQuery = 'SELECT audio_url FROM echoes WHERE id = $1;';
        const echoResult = await pool.query(getEchoQuery, [id]);
        if (echoResult.rowCount === 0) return res.status(404).json({ error: "Echo not found." });
        
        const audioUrl = echoResult.rows[0].audio_url;
        const fileName = audioUrl.substring(audioUrl.lastIndexOf('/') + 1);
        
        const deleteDbResult = await pool.query('DELETE FROM echoes WHERE id = $1 RETURNING *;', [id]);
        
        try {
            const s3 = new S3Client({
                region: 'auto',
                endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
            });
            await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileName }));
        } catch (r2Error) {
            console.error(`Admin: R2 delete failed for ${fileName}, but DB record deleted. Error:`, r2Error);
        }
        res.json({ msg: 'Echo deleted from DB.', deletedEcho: deleteDbResult.rows[0] });
    } catch (err) {
        console.error(`Admin: Error deleting echo ${id}:`, err);
        res.status(500).send('Server Error');
    }
});

app.get('/admin/api/users', adminAuthMiddleware, async (req, res) => {
    try {
        const query = `SELECT id, username, created_at, is_admin FROM users ORDER BY created_at DESC;`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin: Error fetching all users:', err);
        res.status(500).send('Server Error');
    }
});

app.put('/admin/api/users/:id/toggle-admin', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    if (parseInt(req.user.id) === parseInt(id)) {
         const adminCountResult = await pool.query('SELECT COUNT(*) FROM users WHERE is_admin = TRUE');
         if (parseInt(adminCountResult.rows[0].count) <= 1) {
            return res.status(403).json({ error: "Cannot remove admin status from the only admin." });
         }
    }
    try {
        const query = `UPDATE users SET is_admin = NOT is_admin WHERE id = $1 RETURNING id, username, is_admin;`;
        const result = await pool.query(query, [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "User not found." });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Admin: Error toggling admin status for user ${id}:`, err);
        res.status(500).send('Server Error');
    }
});

// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));