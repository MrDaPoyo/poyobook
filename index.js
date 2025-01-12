const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;
const path = require('path');
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(bodyParser.json());

let guestbookEntries = [];

// Get all guestbook entries
app.get('/guestbook', (req, res) => {
    res.json(guestbookEntries);
});

// Add a new guestbook entry
app.post('/guestbook', (req, res) => {
    const entry = req.body;
    guestbookEntries.push(entry);
    res.status(201).json(entry);
});

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/auth', (req, res) => {
    res.render('auth');
});

app.post('/auth/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if (username === 'admin' && password === 'password') {
        res.render('success');
    } else {
        res.render('failure');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`PoyoBook service running at http://localhost:${port}`);
});