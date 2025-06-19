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
const corsOptions = {
  // Pass an array of ALL allowed origins
  origin: [
    'https://echoes-app.netlify.app',          // Your production client app
    'https://echoes-admin-portal.netlify.app'  // Your production admin portal
    // You could also add 'http://localhost:5500' here if you ever want to test locally again
  ],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
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


// --- HELPER FUNCTION for Spotify Auth with DETAILED LOGGING ---
let spotifyToken = { value: null, expires: 0 };

async function getSpotifyToken() {
    // Check if token is still valid (with a 5-minute buffer)
    if (spotifyToken.value && spotifyToken.expires > Date.now()) {
        console.log('[Spotify Auth] Using existing, valid token.');
        return spotifyToken.value;
    }

    console.log('[Spotify Auth] Token is missing or expired. Requesting a new one...');
    
    // Check if credentials are set
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.error('CRITICAL ERROR: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is not set in environment variables.');
        throw new Error('Spotify API credentials are not configured on the server.');
    }
    
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${credentials}`,
            },
            body: 'grant_type=client_credentials',
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Spotify Auth] FAILED to get token. Spotify responded with:', data);
            throw new Error(data.error_description || 'Could not authenticate with Spotify.');
        }

        spotifyToken = {
            value: data.access_token,
            expires: Date.now() + (data.expires_in - 300) * 1000, 
        };
        console.log('[Spotify Auth] Successfully acquired new access token.');
        return spotifyToken.value;

    } catch (error) {
        console.error('[Spotify Auth] Catastrophic failure during token request:', error);
        throw error; // Re-throw the error to be caught by the search route
    }
}


// =======================================================
// --- MEDLEY (BETA) API ROUTES ---
// =======================================================

// GET /api/medley/drops - Fetches nearby, active drops
app.get('/api/medley/drops', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Latitude and longitude are required." });
    
    const DISCOVERY_RADIUS_METERS = 20000; // 20km

    try {
        const query = `
            SELECT id, lat, lng, spotify_uri, item_name, artist_name, album_art_url
            FROM medley_drops
            WHERE 
                ST_DWithin(geog, ST_MakePoint($2, $1)::geography, ${DISCOVERY_RADIUS_METERS})
                AND created_at > NOW() - INTERVAL '1 day' -- Only fetch drops from the last 24 hours
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query, [lat, lng]);
        res.json(result.rows);
    } catch (err) {
        console.error("[Medley] Get Drops DB Error:", err);
        res.status(500).send('Server Error');
    }
});


// In server/index.js

// --- THIS IS THE FINAL, CORRECTED AND SIMPLIFIED SEARCH ROUTE ---
app.get('/api/medley/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Search query "q" is required.' });
    }

    try {
        const token = await getSpotifyToken();

        // --- THE DEFINITIVE FIX ---
        // 1. We use a simple, unstructured query. This lets Spotify's powerful
        //    search algorithm find the best matches across all fields.
        // 2. We increase the limit to get more results, increasing the chance
        //    of finding more obscure tracks.
        const searchUrl = new URL('https://api.spotify.com/v1/search');
        searchUrl.searchParams.append('q', q); // The user's query as-is
        searchUrl.searchParams.append('type', 'track'); // We still only want tracks
        searchUrl.searchParams.append('market', 'GB'); // The market is still crucial
        searchUrl.searchParams.append('limit', '50'); // Increase limit to the maximum allowed
        // --- END OF FIX ---
        
        console.log(`[Medley] Requesting from Spotify: ${searchUrl.toString()}`);

        const response = await fetch(searchUrl.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("[Medley] Spotify API returned an error:", data);
            throw new Error(data.error?.message || 'Spotify search failed');
        }

        // The response structure is an object with a 'tracks' key
        res.json(data.tracks);

    } catch (err) {
        console.error("[Medley] Full Search Error:", err.message);
        res.status(500).json({ error: `Search failed.` });
    }
});

// POST /api/medley/drops - Creates a new anonymous drop
app.post('/api/medley/drops', async (req, res) => {
    const { lat, lng, spotify_uri, item_name, artist_name, album_art_url } = req.body;

    if (!lat || !lng || !spotify_uri || !item_name) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        const insertQuery = `
            INSERT INTO medley_drops (lat, lng, spotify_uri, item_name, artist_name, album_art_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const insertValues = [lat, lng, spotify_uri, item_name, artist_name, album_art_url];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newDrop = insertResult.rows[0];

        // Now, update the geography column for the new drop
        const updateQuery = `UPDATE medley_drops SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newDrop.id]);
        
        res.status(201).json(newDrop);
    } catch (err) {
        console.error('[Medley] Create Drop Error:', err);
        res.status(500).json({ error: 'Failed to save drop.' });
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