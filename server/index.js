// server/index.js - COMPLETE AND UNABRIDGED

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const https = require('https'); // Required for making API calls

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

// --- USER-SPECIFIC ROUTES (Protected) ---

app.get('/api/users/my-echoes', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT id, w3w_address, audio_url, created_at, last_played_at, play_count, location_name
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
        const deleteQuery = `
            DELETE FROM echoes 
            WHERE last_played_at < NOW() - INTERVAL '${EXPIRATION_PERIOD}';
        `;
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

app.post('/admin/api/echoes/seed', adminAuthMiddleware, upload.single('audioFile'), async (req, res) => {
    const { lat, lng, w3w_address } = req.body;
    const admin_user_id = req.user.id;
    const file = req.file;
    if (!lat || !lng || !w3w_address || !file) {
        return res.status(400).json({ error: 'Latitude, Longitude, Location Name, and an audio file are required.' });
    }
    const fileName = `seeded_echo_${Date.now()}_${file.originalname}`;
    const putCommand = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
    });
    try {
        await s3.send(putCommand);
        const audio_url = `${process.env.R2_PUBLIC_URL_BASE}/${fileName}`;
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, last_played_at, location_name) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6) 
            RETURNING id;
        `;
        const insertValues = [w3w_address, audio_url, lat, lng, admin_user_id, w3w_address]; // Use w3w_address as location_name for seeded echoes
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;
        const updateQuery = `UPDATE echoes SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newEchoId]);
        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);
        res.status(201).json(finalResult.rows[0]);
    } catch (err) {
        console.error('Admin Seeding Error:', err);
        res.status(500).json({ error: 'Failed to seed echo due to a server error.' });
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

app.get('/echoes', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Latitude and longitude are required." });
    const EXPIRATION_PERIOD = '20 days'; 
    try {
        const query = `
            SELECT e.*, u.username 
            FROM echoes e 
            LEFT JOIN users u ON e.user_id = u.id 
            WHERE 
                ST_DWithin(geog, ST_MakePoint($2, $1)::geography, 100)
                AND e.last_played_at >= NOW() - INTERVAL '${EXPIRATION_PERIOD}'
            ORDER BY e.created_at DESC;
        `;
        const result = await pool.query(query, [lat, lng]);
        res.json(result.rows);
    } catch (err) {
        console.error("Get Echoes DB Error:", err);
        res.status(500).send('Server Error');
    }
});

app.post('/echoes', authMiddleware, async (req, res) => {
    const { w3w_address, audio_url, lat, lng } = req.body;
    const user_id = req.user.id;
    if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    let friendlyLocationName = 'An unknown location';
    try {
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
    } catch (geoErr) {
        console.error("Reverse geocoding failed, using default name:", geoErr);
    }

    try {
        const insertQuery = `
            INSERT INTO echoes (w3w_address, audio_url, lat, lng, user_id, last_played_at, location_name) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6) 
            RETURNING id;
        `;
        const insertValues = [w3w_address, audio_url, lat, lng, user_id, friendlyLocationName];
        const insertResult = await pool.query(insertQuery, insertValues);
        const newEchoId = insertResult.rows[0].id;

        const updateQuery = `UPDATE echoes SET geog = ST_MakePoint($1, $2) WHERE id = $3;`;
        await pool.query(updateQuery, [lng, lat, newEchoId]);

        const finalQuery = `SELECT e.*, u.username FROM echoes e LEFT JOIN users u ON e.user_id = u.id WHERE e.id = $1;`;
        const finalResult = await pool.query(finalQuery, [newEchoId]);

        res.status(201).json(finalResult.rows[0]);
    } catch (err) {
        console.error('Create Echo DB Error:', err);
        res.status(500).json({ error: 'Failed to save echo to database.' });
    }
});

// NEW route for user to delete their own echo
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