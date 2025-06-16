// server/index.js

require('dotenv').config(); // Loads .env file contents
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Import the pg library

// --- DATABASE CONNECTION SETUP ---
// This creates a "pool" of connections that can be reused.
// It's the standard, professional way to connect to a Postgres database.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // This is required for Render's database connections.
    // It tells your server to accept the connection without extra security checks.
    rejectUnauthorized: false
  }
});


const app = express();
app.use(cors()); // Allows your frontend to talk to this server
app.use(express.json()); // Allows server to understand JSON data


// --- API ENDPOINTS ---

// Test endpoint to make sure server is alive
app.get('/', (req, res) => {
  res.send('Echoes server is alive!');
});


// === ADD THIS NEW ENDPOINT ===
// GETs all echoes from the database
app.get('/echoes', async (req, res) => {
  console.log("Received request for /echoes"); // Good for debugging
  try {
    const result = await pool.query('SELECT * FROM echoes ORDER BY created_at DESC;');
    res.json(result.rows); // Send the list of echoes back as JSON
  } catch (err) {
    console.error('Error fetching echoes:', err);
    res.status(500).send('Server Error');
  }
});
// =============================


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});