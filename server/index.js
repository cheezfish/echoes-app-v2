// server/index.js - FINAL, CLEANED-UP VERSION

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Username already exists.' });
        }
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
        res.status(500).json({ error: 'Server error during login.' });
    }
});

// --- ECHOES ROUTES ---
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
            WHERE ST_DWithin(geog, ST_MakePoint($2, $1)::geography, 100)
            ORDER BY e.created_at DESC;
        `;
        const result = await pool.query(query, [lat, lng]);
        res.json(result.rows);
    } catch (err) {
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
        const sql = 'INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, geog) VALUES ($1, $2, $3, $4, $5, ST_MakePoint($4, $3)) RETURNING *;';
        const values = [w3w_address, audio_url, lat, lng, user_id];
        const result = await pool.query(sql, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).send('Server Error');
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
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Echo not found." });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        res.status(500).send("Server Error");
    }
});

app.post('/presigned-url', async (req, res) => {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
        return res.status(400).json({ error: 'fileName and fileType are required' });
    }
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
        res.status(500).send('Server Error');
    }
});

// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));