// server/index.js - COMPLETE AND UNABRIDGED

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// --- STARTUP ENV VALIDATION ---
const REQUIRED_ENV = ['JWT_SECRET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL_BASE'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}
// REMOVED: const mm = require('music-metadata/lib/core'); -> This caused the crash

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
    limits: { fileSize: 5 * 1024 * 1024 }
});

const pool = require('./db');
const authMiddleware = require('./middleware/auth');
const adminAuthMiddleware = require('./middleware/adminauth');
const { checkAndAwardAchievements } = require('./services/achievements');

const app = express();
const corsOptions = {
    origin: [
        'https://echoes.cheezfish.com',
        'https://echoes-admin.cheezfish.com',
    ],
    credentials: true,
    optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// --- RATE LIMITERS ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later.' },
});
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
});
app.use('/api/', apiLimiter);

// --- ALLOWED AUDIO MIME TYPES (presigned upload + seed) ---
const ALLOWED_AUDIO_TYPES = new Set(['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a']);

// --- USER AUTH ROUTES ---
app.post('/api/users/register', authLimiter, async (req, res) => {
    const { username, password } = req.body;

    // #9 — password & username policy
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3–20 characters and contain only letters, numbers, or underscores.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const result = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username;', [username, password_hash]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Registration failed. Please try a different username.' });
        console.error("Registration DB Error:", err);
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

app.post('/api/users/login', authLimiter, async (req, res) => {
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
            res.cookie('echoes_token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'Lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });
            res.json({ user: { id: user.id, username: user.username } });
        });
    } catch (err) {
        console.error("Login DB Error:", err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});


app.get('/api/users/me', authMiddleware, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username });
});

app.post('/api/users/logout', (req, res) => {
    res.clearCookie('echoes_token', { httpOnly: true, secure: true, sameSite: 'Lax' });
    res.json({ msg: 'Logged out.' });
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
        
        console.log(`[Medley] Requesting from Spotify (query redacted)`);

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
    const EXPIRATION_DAYS = 20;
    try {
        const deleteQuery = `DELETE FROM echoes WHERE last_played_at < NOW() - ($1 * INTERVAL '1 day');`;
        const result = await pool.query(deleteQuery, [EXPIRATION_DAYS]);
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
        // FIXED: Use dynamic import for compatibility with music-metadata v8+ (ESM)
        const { parseBuffer } = await import('music-metadata');
        const metadata = await parseBuffer(file.buffer, file.mimetype);
        duration = Math.round(metadata.format.duration || 0);
        if (duration === 0) throw new Error('Failed to extract a valid duration.');
    } catch (err) {
        console.error('[SEED] ERROR during metadata analysis:', err);
        return res.status(500).json({ error: 'Failed to process audio file metadata.' });
    }

    try {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp3';
        const fileName = `seeded_echo_${Date.now()}_${crypto.randomUUID()}${ext}`;
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Lock the admin count row-level so concurrent requests can't both pass the check
        const adminCountResult = await client.query('SELECT COUNT(*) FROM users WHERE is_admin = TRUE FOR UPDATE');
        if (parseInt(req.user.id) === parseInt(id) && parseInt(adminCountResult.rows[0].count) <= 1) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Cannot remove admin status from the only admin." });
        }
        const result = await client.query(
            `UPDATE users SET is_admin = NOT is_admin WHERE id = $1 RETURNING id, username, is_admin;`,
            [id]
        );
        await client.query('COMMIT');
        if (result.rowCount === 0) return res.status(404).json({ error: "User not found." });
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`Admin: Error toggling admin status for user ${id}:`, err);
        res.status(500).json({ error: 'Failed to toggle admin status due to server error.' });
    } finally {
        client.release();
    }
});

// In server/index.js, replace the entire purge-orphans route with this one.

app.post('/admin/api/storage/purge-orphans', adminAuthMiddleware, async (req, res) => {
    try {
        // Step 1: Page through all live audio URLs (avoids loading entire table into memory)
        const liveUrls = new Set();
        let offset = 0;
        const PAGE = 1000;
        while (true) {
            const page = await pool.query(
                `SELECT audio_url FROM echoes WHERE audio_url IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2`,
                [PAGE, offset]
            );
            page.rows.forEach(r => liveUrls.add(r.audio_url));
            if (page.rows.length < PAGE) break;
            offset += PAGE;
        }

        // Step 2: Page through all R2 objects using ContinuationToken
        const allR2Files = [];
        let continuationToken;
        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: process.env.R2_BUCKET_NAME,
                ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
            });
            const r2Page = await s3.send(listCommand);
            allR2Files.push(...(r2Page.Contents || []));
            continuationToken = r2Page.IsTruncated ? r2Page.NextContinuationToken : undefined;
        } while (continuationToken);

        // Step 3: Identify the orphaned files
        const r2PublicBase = process.env.R2_PUBLIC_URL_BASE;
        if (!r2PublicBase) {
            throw new Error('R2_PUBLIC_URL_BASE is not set on the server.');
        }

        const orphansToDelete = allR2Files.filter(file => {
            const fullUrl = `${r2PublicBase}/${file.Key}`;
            return !liveUrls.has(fullUrl);
        });

        if (orphansToDelete.length === 0) {
            return res.json({ message: 'Scan complete. No orphaned files found.', purgedCount: 0 });
        }

        // Step 4: Prepare and execute the batch delete command
        const deleteKeys = orphansToDelete.map(file => ({ Key: file.Key }));
        const deleteCommand = new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: { Objects: deleteKeys },
        });

        const deleteResult = await s3.send(deleteCommand);

        if (deleteResult.Errors && deleteResult.Errors.length > 0) {
            console.error('Some files could not be purged:', deleteResult.Errors);
            throw new Error('Some files could not be purged. Check server logs.');
        }

        const totalSizePurged = orphansToDelete.reduce((sum, file) => sum + file.Size, 0);
        const sizeInMB = (totalSizePurged / (1024 * 1024)).toFixed(2);

        res.json({
            message: `Successfully purged ${orphansToDelete.length} orphaned files, freeing up ${sizeInMB} MB.`,
            purgedCount: orphansToDelete.length,
            spaceFreedMB: sizeInMB
        });

    } catch (err) {
        console.error('[PURGE] An error occurred:', err);
        res.status(500).json({ error: err.message || 'A server error occurred during the storage purge operation.' });
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
    
    const EXPIRATION_DAYS = 20;

    try {
        // This query selects all echoes within the rectangular bounding box of the map view.
        // It's the most efficient way to get exactly what the user can see.
        const query = `
            SELECT e.*, u.username
            FROM echoes e
            LEFT JOIN users u ON e.user_id = u.id
            WHERE
                geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                AND e.last_played_at >= NOW() - ($5 * INTERVAL '1 day');
        `;
        const values = [sw_lng, sw_lat, ne_lng, ne_lat, EXPIRATION_DAYS];
        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error("Get Echoes by Bounding Box DB Error:", err);
        res.status(500).send('Server Error');
    }
});

// server/index.js - Update POST /echoes

app.post('/echoes', authMiddleware, async (req, res) => {
    // 1. Get duration directly
    const { w3w_address, audio_url, lat, lng, duration } = req.body;
    const user_id = req.user.id;

    // 2. Validate (No longer checking for audio_blob_base64)
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    let friendlyLocationName = 'An unknown location';
    
    // 3. Keep Geocoding Logic
    try {
        if (!process.env.OPENCAGE_API_KEY) {
            console.error("FATAL: OPENCAGE_API_KEY environment variable not set.");
        } else {
            // Key is in query param per OpenCage API requirement — never log this URL
            const geocodeUrl = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(`${lat}+${lng}`)}&key=${process.env.OPENCAGE_API_KEY}&no_annotations=1&limit=1`;
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
        console.error("Error during geocoding phase:", err);
    }

    // 4. Insert into DB using the passed duration
    try {
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, last_played_at, location_name, duration_seconds) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7) 
            RETURNING id;
        `;
        const insertValues = [w3w_address, audio_url, lat, lng, user_id, friendlyLocationName, duration || 0];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;
        
        const updateQuery = `UPDATE echoes SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newEchoId]);

        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);

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

// REPLACE your existing /api/echoes/:id/play route with this one:

app.post('/api/echoes/:id/play', async (req, res) => {
    // NOTICE: We removed 'authMiddleware' from the line above. 
    // This allows anonymous requests to enter the function.

    const { id } = req.params;

    // 1. Manually check for a user token (Optional Auth)
    let listenerId = null;
    const tokenHeader = req.header('Authorization');
    
    // If a token exists and isn't the string "null" or undefined
    if (tokenHeader && tokenHeader.startsWith('Bearer ') && !tokenHeader.includes('null')) {
        try {
            const token = tokenHeader.split(' ')[1];
            // We use the 'jwt' library you already imported at the top of index.js
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            listenerId = decoded.user.id;
        } catch (err) {
            console.warn("[Play] Invalid token provided, treating listener as anonymous.");
        }
    }

    try {
        // 2. Increment play count (The core feature)
        const query = `
            UPDATE echoes SET last_played_at = CURRENT_TIMESTAMP, play_count = play_count + 1
            WHERE id = $1 RETURNING *;
        `;
        const result = await pool.query(query, [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Echo not found." });
        
        const listenedEcho = result.rows[0];

        // 3. Handle Achievements (Only if applicable)
        
        // A. Listener Achievement: Only if we successfully identified the user
        if (listenerId && listenedEcho.user_id !== listenerId) {
            checkAndAwardAchievements(listenerId, 'LISTEN_ECHO', { listenedEcho });
        }
        
        // B. Creator Achievement: Always check for the creator
        if (listenedEcho.user_id) {
            checkAndAwardAchievements(listenedEcho.user_id, 'LISTEN_ECHO', { listenedEcho });
        }

        res.status(200).json(listenedEcho);
    } catch (err) {
        console.error(`Error updating play count for echo ${id}:`, err);
        res.status(500).send("Server Error");
    }
});

app.post('/presigned-url', authMiddleware, async (req, res) => {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) return res.status(400).json({ error: 'fileName and fileType are required' });
    if (!ALLOWED_AUDIO_TYPES.has(fileType)) {
        return res.status(400).json({ error: 'Invalid file type.' });
    }
    // Strip any path components from the filename to prevent traversal
    const safeKey = path.basename(fileName).replace(/[^a-zA-Z0-9._\-]/g, '_');
    const putCommand = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: safeKey, ContentType: fileType });
    try {
        const signedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 60 });
        res.json({ url: signedUrl, key: safeKey });
    } catch (err) {
        console.error("Error creating presigned URL:", err);
        res.status(500).send('Server Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));