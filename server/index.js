// server/index.js - FINAL, BULLETPROOF VERSION

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./middleware/auth');
const adminAuthMiddleware = require('./middleware/adminauth'); // New middleware

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
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const result = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username;', [username, password_hash]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already exists.' });
        console.error("Registration DB Error:", err);
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1;', [username]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });
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

// === ADMIN API ROUTES ===

// Admin Login (could be the same as user login, but checks is_admin after successful login)
// For simplicity now, we'll assume admin uses the normal /api/users/login
// The adminAuth middleware will then protect admin-specific routes.

// GET ALL echoes for admin
app.get('/admin/api/echoes', adminAuthMiddleware, async (req, res) => {
    console.log("Admin request for ALL echoes");
    try {
        const query = `
            SELECT e.*, u.username 
            FROM echoes e
            LEFT JOIN users u ON e.user_id = u.id 
            ORDER BY e.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin: Error fetching all echoes:', err);
        res.status(500).send('Server Error');
    }
});

// DELETE an echo (Admin only)
app.delete('/admin/api/echoes/:id', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    console.log(`Admin request to DELETE echo ID: ${id}`);
    try {
        // First, you might want to delete the file from R2 (more complex, add later)
        // For now, just delete from DB:
        const deleteQuery = 'DELETE FROM echoes WHERE id = $1 RETURNING *;';
        const result = await pool.query(deleteQuery, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Echo not found to delete." });
        }
        // Optionally, delete the file from R2 here
        // const s3 = new S3Client(...);
        // await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: result.rows[0].audio_url.split('/').pop() }));


        res.json({ msg: 'Echo deleted successfully', deletedEcho: result.rows[0] });
    } catch (err) {
        console.error(`Admin: Error deleting echo ${id}:`, err);
        res.status(500).send('Server Error');
    }
});

// --- ECHOES ROUTES ---
app.get('/echoes', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Latitude and longitude are required." });
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
        console.error("Get Echoes DB Error:", err);
        res.status(500).send('Server Error');
    }
});

// <<< THIS IS THE NEW, BULLETPROOF VERSION >>>
app.post('/echoes', authMiddleware, async (req, res) => {
    const { w3w_address, audio_url, lat, lng } = req.body;
    const user_id = req.user.id;
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        // Step 1: Insert the basic data, returning the ID of the new row.
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id;
        `;
        const insertValues = [w3w_address, audio_url, lat, lng, user_id];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;

        // Step 2: Now, run a separate, simple UPDATE to set the geography.
        const updateQuery = `UPDATE echoes SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newEchoId]);

        // Step 3: Fetch the complete record with the username to send back.
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
// <<< ======================================= >>>

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

// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));