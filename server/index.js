// server/index.js

// --- DEPENDENCIES ---
// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // For PostgreSQL connection

// For generating presigned URLs for Cloudflare R2
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');


// --- DATABASE CONNECTION SETUP ---
// This creates a "pool" of connections that can be reused for efficiency.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // Required for connections to Render's managed database
    rejectUnauthorized: false
  }
});


// --- EXPRESS APP SETUP ---
const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing for all routes
app.use(express.json()); // Enable the express app to parse JSON formatted request bodies


// --- API ENDPOINTS ---

// 1. A simple test route to check if the server is live
app.get('/', (req, res) => {
  res.send('Echoes server is alive and well!');
});

// 2. GET all echoes from the database
app.get('/echoes', async (req, res) => {
  console.log("Received request for GET /echoes");
  try {
    const result = await pool.query('SELECT * FROM echoes ORDER BY created_at DESC;');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching echoes:', err);
    res.status(500).send('Server Error');
  }
});

// 3. POST a new echo's metadata to the database
app.post('/echoes', async (req, res) => {
  const { w3w_address, audio_url } = req.body;

  if (!w3w_address || !audio_url) {
    return res.status(400).json({ error: 'w3w_address and audio_url are required' });
  }

  console.log(`Creating new echo metadata for: ${w3w_address}`);
  try {
    const sql = 'INSERT INTO echoes (w3w_address, audio_url) VALUES ($1, $2) RETURNING *;';
    const values = [w3w_address, audio_url];
    const result = await pool.query(sql, values);
    res.status(201).json(result.rows[0]); // Respond with the newly created record
  } catch (err) {
    console.error('Error creating echo metadata:', err);
    res.status(500).send('Server Error');
  }
});

// 4. POST to get a secure, one-time URL to upload a file to Cloudflare R2
app.post('/presigned-url', async (req, res) => {
  const { fileName, fileType } = req.body;
  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'fileName and fileType are required' });
  }

  // Configure the S3 client to talk to our Cloudflare R2 bucket
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  // Prepare the command for a PUT (upload) operation
  const putCommand = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: fileName,          // The name we want the file to have in the bucket
    ContentType: fileType,  // The type of file (e.g., 'audio/webm')
  });

  console.log(`Generating presigned URL for: ${fileName}`);
  try {
    // Generate the special URL that is valid for 60 seconds
    const signedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 60 });
    
    // Send the URL back to the frontend
    res.json({ url: signedUrl });
  } catch (err) {
    console.error('Error creating presigned URL:', err);
    res.status(500).send('Server Error');
  }
});


// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});