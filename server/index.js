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
const Sentiment = require('sentiment');
const sentimentAnalyzer = new Sentiment();
const { clerkMiddleware, getAuth, createClerkClient } = require('@clerk/express');
const webpush = require('web-push');

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// --- STARTUP ENV VALIDATION ---
const REQUIRED_ENV = ['JWT_SECRET', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL_BASE', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_EMAIL'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

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

// --- DB MIGRATION (idempotent, runs at startup) ---
async function runMigrations() {
    const client = await pool.connect();
    try {
        // Clerk auth migration
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT;
            ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
        `);
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id) WHERE clerk_id IS NOT NULL;
        `);

        await client.query(`
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS geohash TEXT;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS country_code TEXT;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS city_name TEXT;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS language_code TEXT DEFAULT 'en';
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS transcript TEXT;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS transcript_status TEXT DEFAULT 'pending';
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS moderation_flags JSONB;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS sentiment_score REAL;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS completion_count INTEGER DEFAULT 0;
            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS report_count INTEGER DEFAULT 0;

            ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS total_plays_received INTEGER DEFAULT 0;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS home_country_code TEXT;

            CREATE TABLE IF NOT EXISTS echo_reactions (
                id SERIAL PRIMARY KEY,
                echo_id INTEGER NOT NULL REFERENCES echoes(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reaction TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(echo_id, user_id, reaction)
            );

            CREATE TABLE IF NOT EXISTS echo_reports (
                id SERIAL PRIMARY KEY,
                echo_id INTEGER NOT NULL REFERENCES echoes(id) ON DELETE CASCADE,
                reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                reason TEXT NOT NULL,
                detail TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS echo_plays_log (
                id SERIAL PRIMARY KEY,
                echo_id INTEGER NOT NULL REFERENCES echoes(id) ON DELETE CASCADE,
                listener_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                listener_lat REAL,
                listener_lng REAL,
                played_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_echoes_geohash ON echoes(geohash);

            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES echoes(id) ON DELETE CASCADE;
            CREATE INDEX IF NOT EXISTS idx_echoes_parent_id ON echoes(parent_id);

            CREATE TABLE IF NOT EXISTS walks (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT,
                is_public BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS walk_echoes (
                id SERIAL PRIMARY KEY,
                walk_id INTEGER NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
                echo_id INTEGER NOT NULL REFERENCES echoes(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(walk_id, echo_id)
            );

            CREATE INDEX IF NOT EXISTS idx_walk_echoes_walk_id ON walk_echoes(walk_id);

            ALTER TABLE echo_plays_log ADD COLUMN IF NOT EXISTS percent_played REAL;
            ALTER TABLE echo_plays_log ADD COLUMN IF NOT EXISTS distance_meters REAL;
            ALTER TABLE echo_plays_log ADD COLUMN IF NOT EXISTS session_id TEXT;

            CREATE TABLE IF NOT EXISTS recording_discards (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                duration_seconds REAL,
                lat REAL,
                lng REAL,
                discarded_at TIMESTAMPTZ DEFAULT NOW()
            );

            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_known_lat REAL;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_known_lng REAL;

            ALTER TABLE echoes ADD COLUMN IF NOT EXISTS expiry_notified BOOLEAN DEFAULT FALSE;

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                preferences JSONB NOT NULL DEFAULT '{"new_echo_scanning":true,"new_echo_listening":true,"first_listen":true,"reply":true,"expiry_warning":true,"milestone_listens":false,"weekly_digest":false}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
        `);
        // Backfill geohash for existing rows that have a geog but no geohash
        await client.query(`
            UPDATE echoes
            SET geohash = ST_GeoHash(geog::geometry, 7)
            WHERE geohash IS NULL AND geog IS NOT NULL;
        `);
        console.log('[Migration] DB schema up to date.');
    } catch (err) {
        console.error('[Migration] Failed:', err.message);
    } finally {
        client.release();
    }
}
runMigrations();

const app = express();
const corsOptions = {
    origin: [
        'https://echoes.cheezfish.com',
        'https://echoes-admin.cheezfish.com',
    ],
    credentials: true,
    optionsSuccessStatus: 200,
};

app.set('trust proxy', 1); // Behind Cloudflare
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(clerkMiddleware());

// --- RATE LIMITERS ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: 'Too many attempts, please try again later.' },
});
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
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

// Clerk user sync — creates DB row on first sign-in, returns existing on subsequent calls
app.post('/api/users/sync', async (req, res) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const existing = await pool.query(
            'SELECT id, username FROM users WHERE clerk_id = $1',
            [userId]
        );
        if (existing.rows.length) return res.json(existing.rows[0]);

        // New Clerk user — fetch profile to build a username
        const clerkUser = await clerkClient.users.getUser(userId);
        let base = '';
        if (clerkUser.firstName) {
            base = clerkUser.firstName.toLowerCase().replace(/[^a-z0-9_]/g, '');
        } else if (clerkUser.emailAddresses?.[0]) {
            base = clerkUser.emailAddresses[0].emailAddress
                .split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
        }
        if (base.length < 3) base = 'echo_user';
        base = base.slice(0, 17);

        // Deduplicate
        let username = base;
        for (let i = 1; i <= 100; i++) {
            const taken = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
            if (!taken.rows.length) break;
            username = `${base}${i}`;
        }

        const result = await pool.query(
            'INSERT INTO users (username, clerk_id) VALUES ($1, $2) RETURNING id, username',
            [username, userId]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[Sync] Error:', err.message);
        res.status(500).json({ error: 'Failed to sync user.' });
    }
});

// --- PUSH NOTIFICATION HELPERS ---

async function sendPush(subscription, payload) {
    try {
        await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            JSON.stringify(payload)
        );
    } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
            pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [subscription.endpoint]).catch(() => {});
        }
    }
}

async function pushToUser(userId, prefKey, payload) {
    try {
        const subs = await pool.query(
            `SELECT endpoint, p256dh, auth FROM push_subscriptions
             WHERE user_id = $1 AND (preferences->$2)::boolean = true`,
            [userId, prefKey]
        );
        for (const sub of subs.rows) await sendPush(sub, payload);
    } catch (_) {}
}

async function notifyNearbyUsers(lat, lng, echoId, locationName, excludeUserId) {
    try {
        const nearby = await pool.query(`
            SELECT ps.endpoint, ps.p256dh, ps.auth, ps.preferences,
                   ST_Distance(
                       ST_MakePoint(u.last_known_lng, u.last_known_lat)::geography,
                       ST_MakePoint($2, $1)::geography
                   ) AS dist_meters
            FROM push_subscriptions ps
            JOIN users u ON ps.user_id = u.id
            WHERE u.last_known_lat IS NOT NULL
              AND u.id != $3
              AND ST_DWithin(
                  ST_MakePoint(u.last_known_lng, u.last_known_lat)::geography,
                  ST_MakePoint($2, $1)::geography,
                  500
              )`,
            [lat, lng, excludeUserId]
        );
        for (const sub of nearby.rows) {
            const prefs = sub.preferences || {};
            const dist = sub.dist_meters;
            if (dist <= 100 && prefs.new_echo_listening) {
                await sendPush(sub, {
                    title: 'Echo within earshot',
                    body: `A new echo just appeared at ${locationName} — you're close enough to listen.`,
                    url: '/'
                });
            } else if (dist <= 500 && prefs.new_echo_scanning) {
                await sendPush(sub, {
                    title: 'Echo nearby',
                    body: `A new echo appeared ${Math.round(dist)}m from you at ${locationName}.`,
                    url: '/'
                });
            }
        }
    } catch (_) {}
}

// --- PUSH ROUTES ---

app.get('/api/push/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
    const { endpoint, p256dh, auth } = req.body;
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Invalid subscription.' });
    try {
        await pool.query(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
            [req.user.id, endpoint, p256dh, auth]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});

app.delete('/api/push/subscribe', authMiddleware, async (req, res) => {
    const { endpoint } = req.body;
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
    res.json({ ok: true });
});

app.patch('/api/push/preferences', authMiddleware, async (req, res) => {
    const { endpoint, preferences } = req.body;
    if (!endpoint || !preferences) return res.status(400).json({ error: 'endpoint and preferences required.' });
    const allowed = ['new_echo_scanning','new_echo_listening','first_listen','reply','expiry_warning','milestone_listens','weekly_digest'];
    const safe = {};
    for (const k of allowed) if (k in preferences) safe[k] = !!preferences[k];
    try {
        await pool.query(
            `UPDATE push_subscriptions SET preferences = preferences || $1::jsonb WHERE endpoint = $2 AND user_id = $3`,
            [JSON.stringify(safe), endpoint, req.user.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update preferences.' });
    }
});

app.get('/api/push/preferences', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT preferences FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
        );
        res.json(result.rows[0]?.preferences || null);
    } catch (err) {
        res.status(500).json({ error: 'Failed.' });
    }
});

// --- USER-SPECIFIC ROUTES (Protected) ---
app.get('/api/users/my-echoes', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT e.id, e.w3w_address, e.audio_url, e.created_at, e.last_played_at,
                   e.play_count, e.location_name, e.duration_seconds,
                   e.transcript, e.transcript_status, e.parent_id,
                   p.location_name AS parent_location_name
            FROM echoes e
            LEFT JOIN echoes p ON e.parent_id = p.id
            WHERE e.user_id = $1
            ORDER BY e.created_at DESC;
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
        
        await pool.query(`UPDATE echoes SET geog = ST_MakePoint($1, $2), geohash = ST_GeoHash(ST_MakePoint($1, $2)::geometry, 7) WHERE id = $3;`, [lng, lat, newEchoId]);

        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);

        res.status(201).json(finalResult.rows[0]);

        // Fire-and-forget transcription for seeded echoes too
        transcribeAndModerate(newEchoId, audio_url);

    } catch (err) {
        console.error('[SEED] CRITICAL ERROR during R2 or Database phase:', err);
        res.status(500).json({ error: 'Failed to save echo due to a server error.' });
    }
});

// ONE-TIME: merge a Clerk user into an existing username account
app.post('/admin/api/merge-clerk-user', adminAuthMiddleware, async (req, res) => {
    const { clerk_id, target_username } = req.body;
    if (!clerk_id || !target_username) return res.status(400).json({ error: 'clerk_id and target_username required.' });
    try {
        // Find target user
        const target = await pool.query('SELECT id FROM users WHERE username = $1', [target_username]);
        if (!target.rows.length) return res.status(404).json({ error: `User "${target_username}" not found.` });
        const targetId = target.rows[0].id;

        // Find duplicate Clerk-created user (if any)
        const dupe = await pool.query('SELECT id FROM users WHERE clerk_id = $1 AND id != $2', [clerk_id, targetId]);

        if (dupe.rows.length) {
            const dupeId = dupe.rows[0].id;
            // Reassign any echoes from the dupe to the target
            await pool.query('UPDATE echoes SET user_id = $1 WHERE user_id = $2', [targetId, dupeId]);
            await pool.query('UPDATE walks SET user_id = $1 WHERE user_id = $2', [targetId, dupeId]);
            await pool.query('DELETE FROM users WHERE id = $1', [dupeId]);
        }

        // Link clerk_id to target
        await pool.query('UPDATE users SET clerk_id = $1 WHERE id = $2', [clerk_id, targetId]);

        res.json({ ok: true, merged: dupe.rows.length > 0, targetId });
    } catch (err) {
        console.error('[MergeClerkUser]', err.message);
        res.status(500).json({ error: err.message });
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

// GET /echoes/clusters — returns geohash-aggregated counts for low-zoom map view
app.get('/echoes/clusters', async (req, res) => {
    const { sw_lng, sw_lat, ne_lng, ne_lat, precision } = req.query;
    if (!sw_lng || !sw_lat || !ne_lng || !ne_lat) return res.json([]);
    const p = Math.min(Math.max(parseInt(precision) || 3, 1), 7);
    const EXPIRATION_DAYS = 20;
    try {
        const result = await pool.query(`
            SELECT
                substring(COALESCE(geohash, ST_GeoHash(geog::geometry, 7)), 1, $5) AS cell,
                COUNT(*)::int AS count,
                AVG(lat) AS center_lat,
                AVG(lng) AS center_lng
            FROM echoes
            WHERE
                geog && ST_MakeEnvelope($1, $2, $3, $4, 4326)
                AND geog IS NOT NULL
                AND COALESCE(is_hidden, FALSE) = FALSE
                AND parent_id IS NULL
                AND last_played_at >= NOW() - ($6 * INTERVAL '1 day')
            GROUP BY cell
            ORDER BY count DESC;
        `, [sw_lng, sw_lat, ne_lng, ne_lat, p, EXPIRATION_DAYS]);
        res.json(result.rows);
    } catch (err) {
        console.error('[Clusters] Error:', err);
        res.status(500).send('Server Error');
    }
});

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
                AND e.parent_id IS NULL
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
    const { w3w_address, audio_url, lat, lng, duration, parent_id } = req.body;
    const user_id = req.user.id;

    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    let friendlyLocationName = 'An unknown location';

    if (parent_id) {
        // Replies inherit the parent's location name — skip geocoding
        try {
            const parentRes = await pool.query('SELECT location_name FROM echoes WHERE id = $1', [parent_id]);
            if (parentRes.rows[0]) friendlyLocationName = parentRes.rows[0].location_name;
        } catch (err) {
            console.error('Error fetching parent echo location:', err);
        }
    } else {
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
    }

    try {
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, last_played_at, location_name, duration_seconds, parent_id)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8)
            RETURNING id;
        `;
        const insertValues = [w3w_address, audio_url, lat, lng, user_id, friendlyLocationName, duration || 0, parent_id || null];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;
        
        await pool.query(`UPDATE echoes SET geog = ST_MakePoint($1, $2), geohash = ST_GeoHash(ST_MakePoint($1, $2)::geometry, 7) WHERE id = $3;`, [lng, lat, newEchoId]);

        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);

        checkAndAwardAchievements(user_id, 'LEAVE_ECHO', { newEcho: finalResult.rows[0] });

        res.status(201).json(finalResult.rows[0]);

        // Fire-and-forget: transcription + push notifications
        transcribeAndModerate(newEchoId, audio_url);

        if (parent_id) {
            // Notify parent echo's owner of the reply
            const parentRow = await pool.query('SELECT user_id, location_name FROM echoes WHERE id = $1', [parent_id]);
            if (parentRow.rows.length && parentRow.rows[0].user_id !== user_id) {
                pushToUser(parentRow.rows[0].user_id, 'reply', {
                    title: 'Someone replied to your echo',
                    body: `A reply was left at ${parentRow.rows[0].location_name}.`,
                    url: '/my-echoes.html'
                });
            }
        } else {
            // Notify users nearby
            notifyNearbyUsers(lat, lng, newEchoId, friendlyLocationName, user_id);
        }
    } catch (err) {
        console.error('Create Echo DB Error:', err);
        res.status(500).json({ error: 'Failed to save echo to database.' });
    }
});

// ── ECHO REPLIES ──────────────────────────────────────────────────────────────

app.get('/echoes/:id/replies', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.*, u.username FROM echoes e
             LEFT JOIN users u ON e.user_id = u.id
             WHERE e.parent_id = $1 AND COALESCE(e.is_hidden, FALSE) = FALSE
             ORDER BY e.created_at ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching replies:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ── WALKS ─────────────────────────────────────────────────────────────────────

app.get('/api/walks/mine', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT w.*, COUNT(we.id)::int AS echo_count
             FROM walks w
             LEFT JOIN walk_echoes we ON we.walk_id = w.id
             WHERE w.user_id = $1
             GROUP BY w.id
             ORDER BY w.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching walks:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.post('/api/walks', authMiddleware, async (req, res) => {
    const { title, description } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
    try {
        const result = await pool.query(
            `INSERT INTO walks (user_id, title, description) VALUES ($1, $2, $3) RETURNING *`,
            [req.user.id, title.trim(), description || null]
        );
        res.status(201).json({ ...result.rows[0], echo_count: 0 });
    } catch (err) {
        console.error('Error creating walk:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.get('/api/walks/:id', async (req, res) => {
    try {
        const walkRes = await pool.query('SELECT * FROM walks WHERE id = $1', [req.params.id]);
        if (walkRes.rowCount === 0) return res.status(404).json({ error: 'Walk not found.' });
        const echoRes = await pool.query(
            `SELECT we.position, e.id AS echo_id, e.location_name, e.audio_url,
                    e.duration_seconds, e.lat, e.lng, e.created_at, u.username
             FROM walk_echoes we
             JOIN echoes e ON we.echo_id = e.id
             LEFT JOIN users u ON e.user_id = u.id
             WHERE we.walk_id = $1
             ORDER BY we.position ASC`,
            [req.params.id]
        );
        res.json({ ...walkRes.rows[0], echoes: echoRes.rows });
    } catch (err) {
        console.error('Error fetching walk:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.delete('/api/walks/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM walks WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(403).json({ error: 'Not permitted.' });
        res.json({ message: 'Walk deleted.' });
    } catch (err) {
        console.error('Error deleting walk:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.post('/api/walks/:id/echoes', authMiddleware, async (req, res) => {
    const { echo_id } = req.body;
    if (!echo_id) return res.status(400).json({ error: 'echo_id required.' });
    try {
        const walkRes = await pool.query('SELECT id FROM walks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (walkRes.rowCount === 0) return res.status(403).json({ error: 'Not permitted.' });
        const posRes = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM walk_echoes WHERE walk_id = $1', [req.params.id]);
        const nextPos = posRes.rows[0].next_pos;
        await pool.query(
            'INSERT INTO walk_echoes (walk_id, echo_id, position) VALUES ($1, $2, $3) ON CONFLICT (walk_id, echo_id) DO NOTHING',
            [req.params.id, echo_id, nextPos]
        );
        res.status(201).json({ message: 'Echo added to walk.' });
    } catch (err) {
        console.error('Error adding echo to walk:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.delete('/api/walks/:id/echoes/:echoId', authMiddleware, async (req, res) => {
    try {
        const walkRes = await pool.query('SELECT id FROM walks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (walkRes.rowCount === 0) return res.status(403).json({ error: 'Not permitted.' });
        await pool.query('DELETE FROM walk_echoes WHERE walk_id = $1 AND echo_id = $2', [req.params.id, req.params.echoId]);
        // Compact positions
        await pool.query(
            `UPDATE walk_echoes we SET position = sub.rn - 1
             FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn FROM walk_echoes WHERE walk_id = $1) sub
             WHERE we.id = sub.id`,
            [req.params.id]
        );
        res.json({ message: 'Echo removed from walk.' });
    } catch (err) {
        console.error('Error removing echo from walk:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────

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

app.post('/api/echoes/:id/play', async (req, res) => {
    const { id } = req.params;
    const { lat, lng, session_id } = req.body || {};

    // Optional auth via Clerk
    let listenerId = null;
    try {
        const { userId: clerkId } = getAuth(req);
        if (clerkId) {
            const row = await pool.query('SELECT id FROM users WHERE clerk_id = $1', [clerkId]);
            if (row.rows.length) listenerId = row.rows[0].id;
        }
    } catch (_) {}

    try {
        const result = await pool.query(
            `UPDATE echoes SET last_played_at = CURRENT_TIMESTAMP, play_count = play_count + 1
             WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Echo not found." });

        const listenedEcho = result.rows[0];

        // Compute distance if listener coords provided
        let distanceMeters = null;
        if (lat != null && lng != null && listenedEcho.lat != null && listenedEcho.lng != null) {
            const toR = d => d * Math.PI / 180;
            const R = 6371000;
            const dLat = toR(listenedEcho.lat - lat);
            const dLng = toR(listenedEcho.lng - lng);
            const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat)) * Math.cos(toR(listenedEcho.lat)) * Math.sin(dLng/2)**2;
            distanceMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        // Log the play event
        const logResult = await pool.query(
            `INSERT INTO echo_plays_log (echo_id, listener_user_id, listener_lat, listener_lng, distance_meters, session_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [id, listenerId, lat ?? null, lng ?? null, distanceMeters, session_id ?? null]
        );
        const playLogId = logResult.rows[0].id;

        // Update listener's last_active_at and known location
        if (listenerId) {
            const locUpdate = lat != null && lng != null
                ? 'UPDATE users SET last_active_at = NOW(), last_known_lat = $2, last_known_lng = $3 WHERE id = $1'
                : 'UPDATE users SET last_active_at = NOW() WHERE id = $1';
            const locParams = lat != null && lng != null ? [listenerId, lat, lng] : [listenerId];
            pool.query(locUpdate, locParams).catch(() => {});
        }

        // Push notifications: first listen + milestones
        const newPlayCount = listenedEcho.play_count;
        if (listenedEcho.user_id && listenedEcho.user_id !== listenerId) {
            if (newPlayCount === 1) {
                pushToUser(listenedEcho.user_id, 'first_listen', {
                    title: 'Your echo was heard',
                    body: `Someone just listened to your echo at ${listenedEcho.location_name}.`,
                    url: '/my-echoes.html'
                });
            } else if ([5, 10, 25, 50, 100].includes(newPlayCount)) {
                pushToUser(listenedEcho.user_id, 'milestone_listens', {
                    title: `${newPlayCount} listens!`,
                    body: `Your echo at ${listenedEcho.location_name} has been heard ${newPlayCount} times.`,
                    url: '/my-echoes.html'
                });
            }
        }

        if (listenerId && listenedEcho.user_id !== listenerId) {
            checkAndAwardAchievements(listenerId, 'LISTEN_ECHO', { listenedEcho });
        }
        if (listenedEcho.user_id) {
            checkAndAwardAchievements(listenedEcho.user_id, 'LISTEN_ECHO', { listenedEcho });
        }

        res.status(200).json({ ...listenedEcho, play_log_id: playLogId });
    } catch (err) {
        console.error(`Error updating play count for echo ${id}:`, err);
        res.status(500).send("Server Error");
    }
});

// POST /api/echoes/:id/play-complete — record completion percentage
app.post('/api/echoes/:id/play-complete', async (req, res) => {
    const { play_log_id, percent_played } = req.body || {};
    if (!play_log_id || percent_played == null) return res.status(400).json({ error: 'play_log_id and percent_played required.' });
    const pct = Math.min(1, Math.max(0, parseFloat(percent_played)));
    try {
        await pool.query(
            `UPDATE echo_plays_log SET percent_played = $1 WHERE id = $2`,
            [pct, play_log_id]
        );
        // Track completion on the echo itself (≥95% counts as completed)
        if (pct >= 0.95) {
            await pool.query(`UPDATE echoes SET completion_count = completion_count + 1 WHERE id = $1`, [req.params.id]);
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[PlayComplete]', err.message);
        res.status(500).json({ error: 'Failed.' });
    }
});

// POST /api/echoes/discard — log a recording that was previewed then discarded
app.post('/api/echoes/discard', async (req, res) => {
    const { duration_seconds, lat, lng } = req.body || {};
    let userId = null;
    try {
        const { userId: clerkId } = getAuth(req);
        if (clerkId) {
            const row = await pool.query('SELECT id FROM users WHERE clerk_id = $1', [clerkId]);
            if (row.rows.length) userId = row.rows[0].id;
        }
    } catch (_) {}
    try {
        await pool.query(
            `INSERT INTO recording_discards (user_id, duration_seconds, lat, lng) VALUES ($1, $2, $3, $4)`,
            [userId, duration_seconds ?? null, lat ?? null, lng ?? null]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('[Discard]', err.message);
        res.status(500).json({ error: 'Failed.' });
    }
});

// GET /admin/api/stats/churn — users who posted ≥1 echo but inactive ≥7 days
app.get('/admin/api/stats/churn', adminAuthMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.display_name, u.last_active_at,
                   COUNT(e.id)::int AS echo_count,
                   MAX(e.created_at) AS last_echo_at
            FROM users u
            JOIN echoes e ON e.user_id = u.id AND e.parent_id IS NULL
            WHERE u.last_active_at < NOW() - INTERVAL '7 days'
               OR u.last_active_at IS NULL
            GROUP BY u.id
            HAVING COUNT(e.id) >= 1
            ORDER BY u.last_active_at DESC NULLS LAST
            LIMIT 200
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[Churn]', err.message);
        res.status(500).json({ error: 'Failed.' });
    }
});

// POST /api/echoes/:id/report — authenticated users flag an echo
app.post('/api/echoes/:id/report', authMiddleware, async (req, res) => {
    const echoId = parseInt(req.params.id);
    const userId = req.user.id;
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({ error: 'A reason is required.' });
    }
    try {
        await pool.query(
            `INSERT INTO echo_reports (echo_id, reporter_user_id, reason) VALUES ($1, $2, $3)`,
            [echoId, userId, reason.trim().slice(0, 500)]
        );
        await pool.query(`UPDATE echoes SET report_count = report_count + 1 WHERE id = $1`, [echoId]);
        res.json({ message: 'Report submitted.' });
    } catch (err) {
        console.error(`[Report] Error for echo ${echoId}:`, err);
        res.status(500).json({ error: 'Failed to submit report.' });
    }
});

// --- TRANSCRIPTION PIPELINE ---
// Fires asynchronously after an echo is saved. No await — caller returns immediately.
async function transcribeAndModerate(echoId, audioUrl) {
    if (!process.env.OPENAI_API_KEY) {
        console.warn('[Transcription] OPENAI_API_KEY not set — skipping.');
        await pool.query(`UPDATE echoes SET transcript_status = 'skipped' WHERE id = $1`, [echoId]);
        return;
    }
    try {
        // 1. Fetch audio from R2
        const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) });
        if (!audioRes.ok) throw new Error(`Failed to fetch audio: HTTP ${audioRes.status}`);
        const audioBuffer = await audioRes.arrayBuffer();

        // 2. Transcribe with Whisper
        const ext = audioUrl.split('.').pop().split('?')[0] || 'webm';
        const mimeMap = { webm: 'audio/webm', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'audio/mp4', m4a: 'audio/x-m4a', ogg: 'audio/ogg' };
        const mime = mimeMap[ext] || 'audio/webm';
        const whisperForm = new FormData();
        whisperForm.append('file', new File([audioBuffer], `echo.${ext}`, { type: mime }));
        whisperForm.append('model', 'whisper-1');

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
            body: whisperForm,
            signal: AbortSignal.timeout(60000)
        });
        if (!whisperRes.ok) throw new Error(`Whisper error: ${await whisperRes.text()}`);
        const { text: transcript } = await whisperRes.json();

        // 3. Moderation check on transcript
        const modRes = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: transcript }),
            signal: AbortSignal.timeout(10000)
        });
        if (!modRes.ok) throw new Error(`Moderation error: ${await modRes.text()}`);
        const modData = await modRes.json();
        const modResult = modData.results[0];

        // 4. Sentiment score — normalised to [-1, 1]
        const sResult = sentimentAnalyzer.analyze(transcript);
        const sentimentScore = sResult.tokens.length > 0
            ? Math.max(-1, Math.min(1, sResult.comparative))
            : null;

        // 5. Write results to DB
        await pool.query(`
            UPDATE echoes SET
                transcript = $1,
                transcript_status = 'done',
                moderation_flags = $2,
                is_flagged = $3,
                sentiment_score = $4
            WHERE id = $5
        `, [transcript, JSON.stringify(modResult.categories), modResult.flagged, sentimentScore, echoId]);

        if (modResult.flagged) {
            const flags = Object.entries(modResult.categories).filter(([, v]) => v).map(([k]) => k).join(', ');
            console.warn(`[Moderation] Echo ${echoId} flagged: ${flags}`);
        } else {
            console.log(`[Transcription] Echo ${echoId} done. Flagged: ${modResult.flagged}, Sentiment: ${sentimentScore?.toFixed(2)}`);
        }
    } catch (err) {
        console.error(`[Transcription] Failed for echo ${echoId}:`, err.message);
        await pool.query(`UPDATE echoes SET transcript_status = 'failed' WHERE id = $1`, [echoId]).catch(() => {});
    }
}

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
// --- EXPIRY NOTIFICATION CRON (every 6 hours) ---
async function runExpiryCron() {
    try {
        const expiring = await pool.query(`
            SELECT e.id, e.user_id, e.location_name
            FROM echoes e
            WHERE e.expiry_notified = FALSE
              AND e.last_played_at < NOW() - INTERVAL '17 days'
              AND e.last_played_at > NOW() - INTERVAL '20 days'
              AND e.user_id IS NOT NULL
        `);
        for (const echo of expiring.rows) {
            await pushToUser(echo.user_id, 'expiry_warning', {
                title: 'Your echo is fading',
                body: `Your echo at ${echo.location_name} hasn't been heard in a while and will disappear in 3 days.`,
                url: '/my-echoes.html'
            });
            await pool.query('UPDATE echoes SET expiry_notified = TRUE WHERE id = $1', [echo.id]);
        }
        if (expiring.rows.length > 0) console.log(`[ExpiryCron] Notified ${expiring.rows.length} expiring echoes.`);
    } catch (err) {
        console.error('[ExpiryCron] Error:', err.message);
    }
}
setInterval(runExpiryCron, 6 * 60 * 60 * 1000);
setTimeout(runExpiryCron, 30000); // run 30s after startup

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));