const express = require('express');
const app = express();
const port = 3000;

// Middleware to parse JSON
app.use(express.json());

// Basic route
app.get('/', (req, res) => {
    res.send('Hello World!');
});

//app.post('/submit-form', (req, res) => {
  //  res.send('Form submitted');
//});

// Apply Middleware
//app.use((req, res, next) => {
  //  console.log(`${req.method} request for ${req.url}`);
    //next();
//});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
})