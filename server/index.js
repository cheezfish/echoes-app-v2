// server/index.js
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
// TODO: Set up database connection here

const app = express();
app.use(cors()); // Allow requests from our frontend
app.use(express.json()); // Allow our server to understand JSON

// --- API ENDPOINTS ---

// Test endpoint
app.get('/', (req, res) => {
  res.send('Echoes server is alive!');
});

// TODO: User registration endpoint (POST /users/register)
// TODO: User login endpoint (POST /users/login)
// TODO: Get echoes for a w3w square (GET /echoes?w3w=filled.count.soap)
// TODO: Create a new echo (POST /echoes)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
