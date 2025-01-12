const express = require('express');
const bodyParser = require('body-parser');
var db = require('./db');
require('dotenv').config();

const app = express();
const port = 3000;
const path = require('path');
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));

var userBlacklist = ['admin', 'administrator', 'root', 'moderator', 'mod', 'staff', 'owner', 'developer', 'dev', 'owner', 'webmaster', 'host', 'support', 'contact', 'info', 'help', 'team', 'blog'];

function checkUsername(username) {
    const regex = /^[a-zA-Z0-9]+$/; // Regex to allow only alphanumeric characters (letters and numbers)

    if (username.length > 20) {
        return 'Username must have at max 20 characters';
    } else if (!regex.test(username)) {
        return 'Username must contain only letters and numbers';
    } else if (userBlacklist.includes(username)) {
        return 'Username is blacklisted, try again with a different username';
    } else {
        return true;
    }
}

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/auth', (req, res) => {
    res.render('auth');
});

app.post('/auth/login', async (req, res) => {
    const { user, password } = req.body;
    if ((!user) || !password) {
        res.status(400).json({ error: 'Missing required fields', success: false });
        return;
    } else {
        try {
            const result = await db.loginUser(user, password);
            if (result.success) {
                res.status(200).json({ message: 'User logged in successfully', jwt: result.jwt, success: result.success });
            } else {
                res.status(400).json({ error: result.message, success: result.success });
            }
        } catch (error) {
            res.status(500).json({ error: JSON.parse(error) });
        }
    }
});

app.post('/auth/register', async (req, res) => {
    var { username, email, password } = await req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Missing required fields', success: false});
    } else if (email.length > 254) {
        return res.status(400).json({ error: 'Email address is too long', success: false });
    }
    username = username.toLowerCase();
    username = username.trim();
    var usernameTest = checkUsername(username);
    if (!usernameTest) {
    	return res.status(400).json({error: usernameTest, success: false});
    }
    if (process.env.CONFIG_MAX_USERS < await db.getUserCount()) {
    	return res.status(400).json({ error: 'Max user capacity reached', success: false})
    } else if (password.length > 7) {
        try {
            const hashedPassword = await db.hashPassword(password);
            const result = await db.createUser(username, email, await hashedPassword);

            if (result.success) {
                res.status(201).json({ message: 'User registered successfully', jwt: result.jwt, success: result.success });
            } else {
                res.status(400).json({ error: result.message, success: result.success });
            }
        } catch (error) {
            res.status(500).json({ error: error });
        }
    } else {
        res.status(400).json({ error: 'Password must be at least 8 characters long', success: false });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`PoyoBook service running at http://localhost:${port}`);
});