// server/index.js - COMPLETE AND UNABRIDGED

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const https = require('https');
const mm = require('music-metadata'); // For reading audio duration

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    },
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

const pool = require('./db');
const authMiddleware = require('./middleware/auth');
const adminAuthMiddleware = require('./middleware/adminauth');
const { checkAndAwardAchievements } = require('./services/achievements');

const app = express();
app.use(cors());
// Increase the limit to allow for Base64 audio data
app.use(express.json({ limit: '10mb' }));

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


// --- USER-SPECIFIC ROUTES (Protected) ---
app.get('/api/users/my-echoes', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT id, w3w_address, audio_url, created_at, last_played_at, play_count, location_name, duration_seconds
            FROM echoes
            WHERE user_id = $1
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(`Error fetching echoes for user ${userId}:`, err);
        res.status(500).json({ error: 'Server error while fetching your echoes.' });
    }
});

// NEW: Endpoint to get ALL possible achievements and which ones the user has unlocked
app.get('/api/achievements', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        // This query fetches all achievements and LEFT JOINS the user's unlocked achievements.
        // If a user has an achievement, user_id will be their ID. If not, it will be NULL.
        const query = `
            SELECT 
                a.id, 
                a.name, 
                a.description, 
                a.icon,
                ua.unlocked_at
            FROM 
                achievements a
            LEFT JOIN 
                user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
            ORDER BY
                ua.unlocked_at DESC, a.id;
        `;
        const result = await pool.query(query, [userId]);
        
        // The result will be a list of all achievements.
        // Each will have an `unlocked_at` field which is either a date or null.
        res.json(result.rows);

    } catch (err) {
        console.error(`Error fetching achievements for user ${userId}:`, err);
        res.status(500).json({ error: 'Server error while fetching achievements.' });
    }
});


// === ADMIN API ROUTES ===
app.get('/admin/api/echoes', adminAuthMiddleware, async (req, res) => {
    try {
        const query = `
            SELECT e.*, u.username, 
                   NOW() - e.last_played_at AS age
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

app.delete('/admin/api/echoes/:id', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const deleteQuery = 'DELETE FROM echoes WHERE id = $1 RETURNING *;';
        const result = await pool.query(deleteQuery, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Echo not found to delete." });
        }
        res.json({ msg: 'Echo deleted successfully', deletedEcho: result.rows[0] });
    } catch (err) {
        console.error(`Admin: Error deleting echo ${id}:`, err);
        res.status(500).send('Server Error');
    }
});

app.post('/admin/api/echoes/prune', adminAuthMiddleware, async (req, res) => {
    const EXPIRATION_PERIOD = '20 days'; 
    try {
        const deleteQuery = `DELETE FROM echoes WHERE last_played_at < NOW() - INTERVAL '${EXPIRATION_PERIOD}';`;
        const result = await pool.query(deleteQuery);
        res.json({ 
            msg: `Pruning complete. ${result.rowCount} expired echo(es) deleted.`,
            deletedCount: result.rowCount
        });
    } catch (err) {
        console.error(`Admin: Error pruning echoes:`, err);
        res.status(500).json({ error: 'Failed to prune echoes due to a server error.' });
    }
});

// In server/index.js

// --- THIS IS THE FINAL, CORRECTED SEEDING ENDPOINT ---
app.post('/admin/api/echoes/seed', adminAuthMiddleware, upload.single('audioFile'), async (req, res) => {
    // The name of the location from the form
    const { lat, lng, w3w_address: location_name } = req.body; 
    const admin_user_id = req.user.id;
    const file = req.file;

    if (!lat || !lng || !location_name || !file) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    let duration = 0;
    try {
        const metadata = await mm.parseBuffer(file.buffer, file.mimetype);
        duration = Math.round(metadata.format.duration || 0);
        if (duration === 0) throw new Error('Failed to extract a valid duration.');
    } catch (err) {
        console.error('[SEED] ERROR during metadata analysis:', err);
        return res.status(500).json({ error: 'Failed to process audio file metadata.' });
    }

    try {
        const fileName = `seeded_echo_${Date.now()}_${file.originalname.replace(/\s/g, '_')}`;
        const putCommand = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME, Key: fileName, Body: file.buffer, ContentType: file.mimetype,
        });
        await s3.send(putCommand);
        
        const R2_PUBLIC_URL_BASE = 'https://pub-01555d49f21d4b6ca8fa85fc6f52fb0a.r2.dev';
        const audio_url = `${R2_PUBLIC_URL_BASE}/${fileName}`;
        
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, last_played_at, location_name, duration_seconds) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7) 
            RETURNING id;
        `;
        
        // =========================================================================
        //  THE CRITICAL FIX IS HERE
        // =========================================================================
        // We now save the human-readable `location_name` to BOTH columns to ensure it always displays correctly.
        const insertValues = [location_name, audio_url, lat, lng, admin_user_id, location_name, duration];
        // =========================================================================

        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;
        
        const updateQuery = `UPDATE echoes SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newEchoId]);
        
        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);
        
        res.status(201).json(finalResult.rows[0]);

    } catch (err) {
        console.error('[SEED] CRITICAL ERROR during R2 or Database phase:', err);
        res.status(500).json({ error: 'Failed to save echo due to a server error.' });
    }
});

app.get('/admin/api/users', adminAuthMiddleware, async (req, res) => {
    try {
        const query = `SELECT id, username, created_at, is_admin FROM users ORDER BY created_at DESC;`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin: Error fetching all users:', err);
        res.status(500).json({ error: 'Failed to fetch users due to server error.' });
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
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "User not found." });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Admin: Error toggling admin status for user ${id}:`, err);
        res.status(500).json({ error: 'Failed to toggle admin status due to server error.' });
    }
});

// --- ECHOES ROUTES ---

// --- FINAL, OPTIMIZED ECHOES ROUTE ---
app.get('/echoes', async (req, res) => {
    // We now expect the map's corner coordinates from the client
    const { sw_lng, sw_lat, ne_lng, ne_lat } = req.query;

    if (!sw_lng || !sw_lat || !ne_lng || !ne_lat) {
        // Fallback for the very first load before the map has bounds
        // This can be a simple query or an empty array.
        // Let's return an empty array to force the user to move the map.
        return res.json([]);
    }
    
    const EXPIRATION_PERIOD = '20 days'; 

    try {
        // This query selects all echoes within the rectangular bounding box of the map view.
        // It's the most efficient way to get exactly what the user can see.
        const query = `
            SELECT e.*, u.username
            FROM echoes e 
            LEFT JOIN users u ON e.user_id = u.id 
            WHERE 
                geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                AND e.last_played_at >= NOW() - INTERVAL '${EXPIRATION_PERIOD}';
        `;
        const values = [sw_lng, sw_lat, ne_lng, ne_lat];
        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error("Get Echoes by Bounding Box DB Error:", err);
        res.status(500).send('Server Error');
    }
});

app.post('/echoes', authMiddleware, async (req, res) => {
    const { w3w_address, audio_url, lat, lng, audio_blob_base64 } = req.body;
    const user_id = req.user.id;
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined || !audio_blob_base64) {
        return res.status(400).json({ error: 'All fields including audio data are required' });
    }

    let friendlyLocationName = 'An unknown location';
    let duration = 0;

    try {
        const audioBuffer = Buffer.from(audio_blob_base64, 'base64');
        const metadata = await mm.parseBuffer(audioBuffer, 'audio/webm');
        duration = Math.round(metadata.format.duration || 0);
        
        if (!process.env.OPENCAGE_API_KEY) {
            console.error("FATAL: OPENCAGE_API_KEY environment variable not set. Reverse geocoding will fail.");
        } else {
            const geocodeUrl = `https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lng}&key=${process.env.OPENCAGE_API_KEY}&no_annotations=1&limit=1`;
            const geoData = await new Promise((resolve, reject) => {
                https.get(geocodeUrl, (apiRes) => {
                    let data = '';
                    apiRes.on('data', chunk => data += chunk);
                    apiRes.on('end', () => resolve(JSON.parse(data)));
                }).on('error', err => reject(err));
            });

            if (geoData && geoData.results && geoData.results.length > 0) {
                const components = geoData.results[0].components;
                friendlyLocationName = components.road || components.neighbourhood || components.suburb || components.city || components.state || 'A discovered place';
            }
        }
    } catch (err) {
        console.error("Error during metadata/geocoding phase:", err);
    }

    try {
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, last_played_at, location_name, duration_seconds) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7) 
            RETURNING id;
        `;
        const insertValues = [w3w_address, audio_url, lat, lng, user_id, friendlyLocationName, duration];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;
        
        const updateQuery = `UPDATE echoes SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newEchoId]);

        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);

        // NEW: Trigger achievement check in the background
        checkAndAwardAchievements(user_id, 'LEAVE_ECHO', { newEcho: finalResult.rows[0] });

        res.status(201).json(finalResult.rows[0]);
    } catch (err) {
        console.error('Create Echo DB Error:', err);
        res.status(500).json({ error: 'Failed to save echo to database.' });
    }
});

app.delete('/api/echoes/:id', authMiddleware, async (req, res) => {
    const echoId = req.params.id;
    const userId = req.user.id;
    try {
        const deleteQuery = 'DELETE FROM echoes WHERE id = $1 AND user_id = $2 RETURNING *;';
        const result = await pool.query(deleteQuery, [echoId, userId]);
        if (result.rowCount === 0) {
            return res.status(403).json({ error: "Action not permitted." });
        }
        res.json({ message: "Echo deleted successfully." });
    } catch (err) {
        console.error(`Error deleting echo ${echoId} by user ${userId}:`, err);
        res.status(500).json({ error: "Server error while deleting echo." });
    }
});

// In server/index.js, inside the POST /api/echoes/:id/play route

app.post('/api/echoes/:id/play', authMiddleware, async (req, res) => { // Added authMiddleware here
    const { id } = req.params;
    const userId = req.user.id; // We need the user's ID to check achievements
    try {
        const query = `
            UPDATE echoes SET last_played_at = CURRENT_TIMESTAMP, play_count = play_count + 1
            WHERE id = $1 RETURNING *;
        `;
        const result = await pool.query(query, [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Echo not found." });
        
        const listenedEcho = result.rows[0];

        // NEW: Trigger achievement check in the background
        // We only check if the user is listening to someone else's echo
        if (listenedEcho.user_id !== userId) {
            checkAndAwardAchievements(userId, 'LISTEN_ECHO', { listenedEcho });
        }
        
        // Also check if the original creator has hit the Century Club
        checkAndAwardAchievements(listenedEcho.user_id, 'LISTEN_ECHO', { listenedEcho });


        res.status(200).json(listenedEcho);
    } catch (err) {
        console.error(`Error updating play count for echo ${id}:`, err);
        res.status(500).send("Server Error");
    }
});

app.post('/presigned-url', async (req, res) => {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) return res.status(400).json({ error: 'fileName and fileType are required' });
    const putCommand = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileName, ContentType: fileType });
    try {
        const signedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 60 });
        res.json({ url: signedUrl });
    } catch (err) {
        console.error("Error creating presigned URL:", err);
        res.status(500).send('Server Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));