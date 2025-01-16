const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
var db = require('./db');
const fs = require('fs-extra');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const multer = require('multer');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif') {
            cb(null, true);
        } else {
            cb(new Error('Not a valid image extension! Please upload a .jpg, .jpeg, .png, or .gif file.'), false);
        }
    } else {
        cb(new Error('Not an image! Please upload an image.'), false);
    }
};

const drawboxUploadImage = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024
    }
}).single('image');

const app = express();
const port = 3000;
const path = require('path');
const sharp = require('sharp');

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
        res.clearCookie('authorization');
        next();
        return;
    }
    jwt.verify(token, process.env.AUTH_SECRET, async (err, decoded) => {
        if (err) {
            res.locals.user = null;
            res.clearCookie('authorization');
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
            res.render('index', { title: 'Free drawboxes for everyone :3' });
        } else {
            var userId = await db.getUserIdByUsername(host);
            var drawbox = await db.getDrawboxById(userId);
            drawbox.images = await db.getDrawboxEntries(drawbox.id);
            if (drawbox) {
                res.render('drawbox', { drawbox: drawbox, title: `${host}'s Guestbook!` });
            } else {
                res.status(404).send('Drawbox not found :P');
            }
        }
    } catch (error) {
        console.log(error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/retrieveImage/:id', async (req, res) => {
    const host = req.headers.host;
    const drawbox = await db.getDrawboxByUsername(host);

    if (!drawbox) {
        return res.status(404).json({ error: 'Drawbox not found', success: false });
    }

    const userDir = path.join('users', drawbox.username, 'images');
    const id = req.params.id;
    const filePath = path.join(userDir, id);
    res.sendFile(filePath);
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
                fs.ensureDirSync(path.join("users", username));
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
    res.render('dashboard', { user: user, drawbox: await db.getDrawboxById(user.id), title: 'Dashboard' });
});

app.get('/logout', (req, res) => {
    res.clearCookie('authorization');
    res.redirect('/');
});

app.post('/addEntry', drawboxUploadImage, async (req, res) => {
    const host = req.headers.host;
    const drawbox = await db.getDrawboxByUsername(host);

    if (!drawbox) {
        return res.status(404).json({ error: 'Drawbox gone poof! :P', success: false });
    }

    const userDir = path.join('users', drawbox.username, 'images');

    try {
        await fs.ensureDir(userDir);
        const filePath = path.join(userDir, req.file.filename);
        await fs.move(req.file.path, filePath);

        await sharp(filePath)
            .resize(100, 100)
            .toFile(path.join(userDir, 'resized-' + req.file.filename));
        db.addEntry(drawbox.id, req.body.message, req.file.filename);
        res.status(200).json({ message: 'Image uploaded and resized successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/setDomain', loggedInMiddleware, async (req, res) => {
    const { domain } = req.body;
    const userId = req.user.id;

    try {
        const query = `UPDATE drawboxes SET domain = ? WHERE userID = ?`;
        await db.db.run(query, [domain, userId]);
        res.redirect('/dashboard?message=Domain set successfully! :3');
    } catch (error) {
        res.status(500).json({ error: error.message, success: false });
    }
});

fs.ensureDirSync('users');

// Start the server
app.listen(port, () => {
    console.log(`PoyoBook service running at http://localhost:${port}`);
});