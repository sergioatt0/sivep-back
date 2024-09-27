require('dotenv').config(); // Load environment variables
const express = require('express');
const { Pool } = require('pg'); // Import the pg module
const bodyParser = require('body-parser'); // Middleware for handling form data
const app = express();
const port = 3000;

// Set up PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
})

// Set up view engine to use EJS
app.set('view engine', 'ejs');

// Middleware for parsing JSON and form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Home route to render the main view
app.get('/', (req, res) => {
  res.render('index'); // Render an index.ejs file from the views folder
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// POST route to handle form submissions
app.post('/submit', (req, res) => {
  const { name } = req.body;
  res.send(`Hello, ${name} we were waiting for you!`);
});

// GET route to return a simple API response
app.get('/api/data', (req, res) => {
  const data = {
    message: 'Hello from the API!',
    status: 'success'
  };
  res.json(data);
});

// POST route for the API
app.post('/api/submit', (req, res) => {
  const { info } = req.body;
  res.json({ message: `Received ${info}`, status: 'success' });
});


// GET info from DB
// Basic route to test the connection
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error connecting to the database');
  }
});

// Get basic info
app.get('/db-test-basic-info', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.basic_info');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error connecting to the database');
  }
});

// Close the DB connection
process.on('exit', () => {
  pool.end();
});
