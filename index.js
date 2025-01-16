const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
var db = require('./db');
const fs = require('fs-extra');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = 3000;
const path = require('path');

app.use(cookieParser());
app.use(bodyParser.json());
app.set('views', 'views');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

function checkGuestbookUsername(username) {
    const regex = /^[a-zA-Z0-9 ]+$/; // Regex to allow alphanumeric characters and spaces

    if (username.length > 20) {
        return 'Username must have at max 20 characters';
    } else if (!regex.test(username)) {
        return 'Username must contain only letters and numbers';
    } else {
        return true;
    }
}

const basicMiddleware = async (req, res, next) => {
    res.locals.env = process.env;
    res.locals.message = req.query.message || null;
    next();
}

app.use(basicMiddleware);

const userMiddleware = async (req, res, next) => {
    const token = req.cookies['authorization'];
    if (!token) {
        res.locals.user = null;
        cookieParser.clearCookie('authorization');
        next();
        return;
    }
    jwt.verify(token, process.env.AUTH_SECRET, async (err, decoded) => {
        if (err) {
            res.locals.user = null;
            cookieParser.clearCookie('authorization');
            next();
        } else {
            res.locals.user = await db.getUserById(decoded.id);
            next();
        }
    });
}

const loggedInMiddleware = async (req, res, next) => {
    const token = req.cookies['authorization'];
    if (!token) {
        res.status(401).json({ error: 'Unauthorized', success: false });
        return;
    }
    jwt.verify(token, process.env.AUTH_SECRET, (err, decoded) => {
        if (err) {
            cookieParser.clearCookie('authorization');
            return { success: false };
        }
        db.doesUserExist(decoded.id).then((exists) => {
            if (!exists) {
                res.redirect('/?message=Unauthorized');
                return;
            }
        });
        req.user = decoded;
        res.locals.user = decoded;
        next();
    });
}

const notLoggedInMiddleware = async (req, res, next) => {
    const token = req.cookies['authorization'];
    if (token) {
        jwt.verify(token, process.env.AUTH_SECRET, (err, decoded) => {  
            if (err) {
                cookieParser.clearCookie('authorization');
                return { success: false };
            }
            res.locals.user = decoded;
        });
    }
    next();
}

app.get('/', userMiddleware, async (req, res) => {
    var host = req.headers.host;
    host = await host.split('.')[0];
    try {
        if (req.headers.host == process.env.HOST) {
            res.render('index', { title: 'Free guestbooks for everyone :3' });
        } else {
            var guestbook = await db.getGuestbookByUsername(host);
            if (guestbook) {
                res.render('guestbook', { guestbook: guestbook, title: `${host}'s Guestbook!` });
            } else {
                res.status(404).send('Guestbook not found');
            }
        }
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

app.get('/auth', notLoggedInMiddleware, (req, res) => {
    res.render('auth', {title: 'Auth'});
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if ((!email) || !password) {
        res.status(400).json({ error: 'Missing required fields', success: false });
        return;
    } else {
        try {
            const result = await db.loginUser(email, password);
            if (result.success) {
                res.cookie('authorization', result.jwt, { httpOnly: true, secure: true });
                res.redirect('/dashboard');
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
        return res.status(400).json({ error: 'Missing required fields', success: false });
    } else if (email.length > 254) {
        return res.status(400).json({ error: 'Email address is too long', success: false });
    }
    username = username.toLowerCase();
    username = username.trim();
    var usernameTest = checkUsername(username);
    if (!usernameTest) {
        return res.status(400).json({ error: usernameTest, success: false });
    }
    if (process.env.CONFIG_MAX_USERS < await db.getUserCount()) {
        return res.status(400).json({ error: 'Max user capacity reached', success: false })
    } else if (password.length > 7) {
        try {
            const hashedPassword = await db.hashPassword(password);
            const result = await db.createUser(username, email, await hashedPassword);

            if (result.success) {
                fs.mkdirSync(path.join("users", username));
                res.cookie('authorization', result.jwt, { httpOnly: true, secure: true });
                res.redirect('/dashboard?message=Account created successfully! :3');
            } else {
                res.redirect('/auth/?message=' + result.error);
            }
        } catch (error) {
            res.redirect('/auth/?message=' + error.message)
        }
    } else {
        res.redirect('/auth/?message=Password must be at least 8 characters long')
    }
});

app.get('/dashboard', loggedInMiddleware, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    res.render('dashboard', { user: user, guestbook: await db.getGuestbookByUsername(await user.username), title: 'Dashboard' });
});

app.get('/logout', (req, res) => {
    res.clearCookie('authorization');
    res.redirect('/');
});

app.post('/addEntry', async (req, res) => {
    var host = req.headers.host;
    const user = host.split('.')[0];
    const userId = await db.getUserIdByUsername(user);
    if (!userId) {
        return res.status(400).json({ error: 'Guestbook gone poof! :P', success: false });
    }
    var { username, message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message is required', success: false });
    }
    if (!username) {
        username = 'Anonymous' + Math.floor(Math.random() * 1000);
    }
    username = username.toLowerCase().trim();
    const usernameTest = checkGuestbookUsername(username);
    if (usernameTest !== true) {
        return res.status(400).json({ error: usernameTest, success: false });
    }
    try {
        db.addEntry(userId, username, req.body.website || null, message);
        res.redirect('/?message=Entry added successfully! :3');
    } catch (error) {
        res.status(500).json({ error: error.message, success: false });
    }
});

fs.ensureDirSync('users');

// Start the server
app.listen(port, () => {
    console.log(`PoyoBook service running at http://localhost:${port}`);
});