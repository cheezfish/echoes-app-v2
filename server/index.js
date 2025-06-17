// server/index.js - FINAL, HARDENED VERSION

require('dotenv').config();
const express = require('express');
const cors =require('cors');
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

// <<< THIS IS THE CORRECTED, ROBUST VERSION >>>
app.post('/echoes', authMiddleware, async (req, res) => {
    const { w3w_address, audio_url, lat, lng } = req.body;
    const user_id = req.user.id;
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const client = await pool.connect(); // Get a client from the pool for a transaction
    try {
        await client.query('BEGIN'); // Start a transaction

        // Step 1: Insert the main data and get the new echo's ID
        const insertEchoQuery = 'INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id;';
        const insertEchoValues = [w3w_address, audio_url, lat, lng, user_id];
        const result = await client.query(insertEchoQuery, insertEchoValues);
        const newEchoId = result.rows[0].id;

        // Step 2: Update the record we just created to populate the 'geog' column
        const updateGeogQuery = 'UPDATE echoes SET geog = ST_MakePoint(lng, lat) WHERE id = $1;';
        await client.query(updateGeogQuery, [newEchoId]);

        await client.query('COMMIT'); // Commit the transaction

        // Step 3: Fetch the full, final record to send back to the user
        const finalRecordQuery = 'SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;';
        const finalResult = await pool.query(finalRecordQuery, [newEchoId]);

        res.status(201).json(finalResult.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK'); // If anything fails, undo all changes
        console.error('TRANSACTION FAILED - Create Echo DB Error:', err); // Better logging
        res.status(500).send('Server Error');
    } finally {
        client.release(); // Release the client back to the pool
    }
});
// <<< ======================================= >>>

app.post('/api/echoes/:id/play', async (req, res) => { /* ... no change ... */ });
app.post('/presigned-url', async (req, res) => { /* ... no change ... */ });

// (Copying unchanged functions for completeness)
app.post('/api/echoes/:id/play',async(e,s)=>{const{id:t}=e.params;try{const o=await pool.query("UPDATE echoes SET last_played_at = CURRENT_TIMESTAMP, play_count = play_count + 1 WHERE id = $1 RETURNING id, play_count, last_played_at;",[t]);0===o.rowCount?s.status(404).json({error:"Echo not found."}):s.status(200).json(o.rows[0])}catch(o){console.error(`Error updating play count for echo ${t}:`,o),s.status(500).send("Server Error")}});
app.post('/presigned-url',async(e,s)=>{const{fileName:t,fileType:o}=e.body;if(!t||!o)return s.status(400).json({error:"fileName and fileType are required"});const r=new S3Client({region:"auto",endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}}),a=new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:t,ContentType:o});try{const n=await getSignedUrl(r,a,{expiresIn:60});s.json({url:n})}catch(n){console.error("Error creating presigned URL:",n),s.status(500).send("Server Error")}});

// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));