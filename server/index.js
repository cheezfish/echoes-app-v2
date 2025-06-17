// server/index.js - FINAL AUTHENTICATED VERSION

// --- DEPENDENCIES ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./middleware/auth'); // Import the auth "guard"

// --- SETUP ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json());


// === USER AUTHENTICATION ROUTES ===

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
        console.error("Registration error:", err);
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
        console.error("Login error:", err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});


// === ECHOES ROUTES (UPGRADED) ===

app.get('/echoes', async (req, res) => {
    console.log("Received request for GET /echoes with author names");
    try {
        const query = `
            SELECT echoes.*, users.username 
            FROM echoes 
            LEFT JOIN users ON echoes.user_id = users.id 
            ORDER BY echoes.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching echoes:', err);
        res.status(500).send('Server Error');
    }
});

app.post('/echoes', authMiddleware, async (req, res) => {
    const { w3w_address, audio_url, lat, lng } = req.body;
    const user_id = req.user.id;
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    console.log(`User ${user_id} creating new echo for: ${w3w_address}`);
    try {
        const sql = 'INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *;';
        const values = [w3w_address, audio_url, lat, lng, user_id];
        const result = await pool.query(sql, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating echo metadata:', err);
        res.status(500).send('Server Error');
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
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    const putCommand = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        ContentType: fileType,
    });
    console.log(`Generating presigned URL for: ${fileName}`);
    try {
        const signedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 60 });
        res.json({ url: signedUrl });
    } catch (err) {
        console.error('Error creating presigned URL:', err);
        res.status(500).send('Server Error');
    }
});


// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));