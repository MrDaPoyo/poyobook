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

app.get('/:path', async (req, res) => {
    res.render(await req.params.path, (err, html) => {
        if (err) {
            res.status(404).send('File not found');
        } else {
            res.send(html);
        }
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Guestbook service running at http://localhost:${port}`);
});