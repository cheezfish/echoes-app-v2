// server/index.js - WITH "THE FADE" MECHANIC

// --- DEPENDENCIES (No changes) ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./middleware/auth');

// --- SETUP (No changes) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const app = express();
app.use(cors());
app.use(express.json());


// --- USER AUTH ROUTES (No changes) ---
app.post('/api/users/register', async (req, res) => { /* ... no change ... */ });
app.post('/api/users/login', async (req, res) => { /* ... no change ... */ });


// --- ECHOES ROUTES (UPGRADED) ---

// 1. GET all "living" echoes, now with author's username
app.get('/echoes', async (req, res) => {
    console.log("Received request for GET /echoes (living only)");
    try {
        // <<< THE FADE LOGIC >>>
        // Only select echoes that have been played in the last 30 days.
        const query = `
            SELECT echoes.*, users.username 
            FROM echoes 
            LEFT JOIN users ON echoes.user_id = users.id 
            WHERE echoes.last_played_at > NOW() - INTERVAL '30 days'
            ORDER BY echoes.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching living echoes:', err);
        res.status(500).send('Server Error');
    }
});

// 2. POST a new echo's metadata (Unchanged)
app.post('/echoes', authMiddleware, async (req, res) => { /* ... no change ... */ });


// 3. === NEW: The "Keep-Alive" Endpoint ===
// This endpoint is called when a user plays an echo.
app.post('/api/echoes/:id/play', async (req, res) => {
    const { id } = req.params; // Get the echo ID from the URL (e.g., /api/echoes/123/play)
    
    console.log(`Received play event for echo ID: ${id}`);
    try {
        const query = `
            UPDATE echoes 
            SET 
                last_played_at = CURRENT_TIMESTAMP, 
                play_count = play_count + 1
            WHERE id = $1
            RETURNING id, play_count, last_played_at;
        `;
        const result = await pool.query(query, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Echo not found." });
        }

        // Send back a confirmation
        res.status(200).json(result.rows[0]);

    } catch (err) {
        console.error(`Error updating play count for echo ${id}:`, err);
        res.status(500).send("Server Error");
    }
});


// 4. Presigned URL route (Unchanged)
app.post('/presigned-url', async (req, res) => { /* ... no change ... */ });


// (Copying unchanged functions for completeness)
app.post('/api/users/register',async(e,s)=>{const{username:t,password:o}=e.body;if(!t||!o)return s.status(400).json({error:"Username and password are required."});try{const r=await bcrypt.genSalt(10),a=await bcrypt.hash(o,r),n=await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username;",[t,a]);s.status(201).json(n.rows[0])}catch(r){console.error("Registration error:",r),"23505"===r.code?s.status(409).json({error:"Username already exists."}):s.status(500).json({error:"Server error during registration."})}});
app.post('/api/users/login',async(e,s)=>{const{username:t,password:o}=e.body;if(!t||!o)return s.status(400).json({error:"Username and password are required."});try{const r=await pool.query("SELECT * FROM users WHERE username = $1;",[t]),a=r.rows[0];if(!a)return s.status(401).json({error:"Invalid credentials."});const n=await bcrypt.compare(o,a.password_hash);if(!n)return s.status(401).json({error:"Invalid credentials."});const c={user:{id:a.id,username:a.username}};jwt.sign(c,process.env.JWT_SECRET,{expiresIn:"7d"},(e,t)=>{if(e)throw e;s.json({token:t})})}catch(r){console.error("Login error:",r),s.status(500).json({error:"Server error during login."})}});
app.post('/echoes',authMiddleware,async(e,s)=>{const{w3w_address:t,audio_url:o,lat:r,lng:a}=e.body,n=e.user.id;if(!t||!o||void 0===r||void 0===a)return s.status(400).json({error:"All fields are required"});console.log(`User ${n} creating new echo for: ${t}`);try{const d="INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *;",i=[t,o,r,a,n],c=await pool.query(d,i);s.status(201).json(c.rows[0])}catch(d){console.error("Error creating echo metadata:",d),s.status(500).send("Server Error")}});
app.post('/presigned-url',async(e,s)=>{const{fileName:t,fileType:o}=e.body;if(!t||!o)return s.status(400).json({error:"fileName and fileType are required"});const r=new S3Client({region:"auto",endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}}),a=new PutObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:t,ContentType:o});console.log(`Generating presigned URL for: ${t}`);try{const n=await getSignedUrl(r,a,{expiresIn:60});s.json({url:n})}catch(n){console.error("Error creating presigned URL:",n),s.status(500).send("Server Error")}});


// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));