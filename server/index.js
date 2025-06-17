// server/index.js - USER ACCOUNTS UPDATE

// --- DEPENDENCIES ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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


// === ECHOES ROUTES (Unchanged for now) ===
app.get('/echoes', async(req, res) => { /* ... unchanged ... */ });
app.post('/echoes', async(req, res) => { /* ... unchanged ... */ });
app.post('/presigned-url', async(req, res) => { /* ... unchanged ... */ });

// (Copying unchanged functions for completeness)
app.get('/echoes',async(e,s)=>{try{const o=await pool.query("SELECT * FROM echoes ORDER BY created_at DESC;");s.json(o.rows)}catch(o){console.error("Error fetching echoes:",o),s.status(500).send("Server Error")}});
app.post('/echoes',async(e,s)=>{const{w3w_address:o,audio_url:t,lat:r,lng:n}=e.body;if(!o||!t||void 0===r||void 0===n)return s.status(400).json({error:"w3w_address, audio_url, lat, and lng are required"});try{const a="INSERT INTO echoes (w3w_address, audio_url, lat, lng) VALUES ($1, $2, $3, $4) RETURNING *;",i=[o,t,r,n],c=await pool.query(a,i);s.status(201).json(c.rows[0])}catch(o){console.error("Error creating echo metadata:",o),s.status(500).send("Server Error")}});
app.post('/presigned-url',async(e,s)=>{const{fileName:o,fileType:t}=e.body;if(!o||!t)return s.status(400).json({error:"fileName and fileType are required"});const r=new S3Client({region:"auto",endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}}),n=new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:o,ContentType:t});try{const a=await getSignedUrl(r,n,{expiresIn:60});s.json({url:a})}catch(o){console.error("Error creating presigned URL:",o),s.status(500).send("Server Error")}});

// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));