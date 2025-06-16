// server/index.js - THE FINAL VERSION

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

app.get('/', (req, res) => res.send('Echoes server is live!'));

// GET all echoes
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

// POST a new echo's metadata
app.post('/echoes', async (req, res) => {
  // Now we accept lat and lng!
  const { w3w_address, audio_url, lat, lng } = req.body;

  if (!w3w_address || !audio_url || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'w3w_address, audio_url, lat, and lng are required' });
  }

  console.log(`Creating new echo for: ${w3w_address}`);
  try {
    const sql = 'INSERT INTO echoes (w3w_address, audio_url, lat, lng) VALUES ($1, $2, $3, $4) RETURNING *;';
    const values = [w3w_address, audio_url, lat, lng];
    const result = await pool.query(sql, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating echo metadata:', err);
    res.status(500).send('Server Error');
  }
});

// POST to get a presigned URL
app.post('/presigned-url', async (req, res) => {
  const { fileName, fileType } = req.body;
  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'fileName and fileType are required' });
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const putCommand = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: fileName,
    ContentType: fileType,
  });

  console.log(`Generating presigned URL for: ${fileName}`);
  try {
    const signedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 60 });
    res.json({ url: signedUrl });
  } catch (err) {
    console.error('Error creating presigned URL:', err);
    res.status(500).send('Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));