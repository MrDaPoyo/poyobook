const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
var db = require('./db');
const fs = require('fs-extra');
const cookieParser = require('cookie-parser');
require('dotenv').config();


const app = express();
const port = process.env.PORT;
const path = require('path');
const sharp = require('sharp');

app.use(cookieParser());
app.use(bodyParser.json({ limit: '1mb' }));
app.set('views', 'views');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
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

const sameSiteMiddleware = async (req, res, next) => {
    if (req.hostname != process.env.CLEAN_HOST) {
        res.redirect('/?message=Unauthorized >P');
        return;
    }
    next();
}

const loggedInMiddleware = async (req, res, next) => {
    const token = req.cookies['authorization'];
    if (!token) {
        res.redirect('/?message=Unauthorized >8(');
        return;
    }
    jwt.verify(token, process.env.AUTH_SECRET, (err, decoded) => {
        if (err) {
            cookieParser.clearCookie('authorization');
            return { success: false };
        }
        db.doesUserExist(decoded.id).then((exists) => {
            if (!exists) {
                res.clearCookie('authorization');
                res.redirect('/?message=Unauthorized >8(');
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
    var host = req.headers.host.split(':')[0] || req.headers.host;
    try {
        if (req.headers.host == process.env.HOST) {
            return res.render('index', { title: 'Free drawboxes for everyone :3' });
        } else {
            var drawbox = await db.getDrawboxByHost(host);
            if (drawbox) {
                drawbox.images = await db.getDrawboxEntries(drawbox.id);
            } else {
                return res.status(404).send('Drawbox not found :P');
            }
            if (drawbox) {
                return res.render('drawbox', { drawbox: drawbox, title: `${drawbox.name}'s Guestbook!` });
            } else {
                return res.status(404).send('Drawbox not found :P');
            }
        }
    } catch (error) {
        console.log(error);
        return res.status(500).send('Internal Server Error');
    }
});

app.get('/drawbox/:drawboxId', userMiddleware, loggedInMiddleware, async (req, res) => {
    const drawbox = await db.getDrawboxById(req.params.drawboxId);
    if (!drawbox) {
        return res.status(404).json({ error: 'Drawbox not found', success: false });
    }
    drawbox.images = await db.getDrawboxEntries(drawbox.id);
    res.render('drawbox', { drawbox: drawbox, title: `${drawbox.name}'s Guestbook!` });
});

app.get('/retrieveImage/:id', async (req, res) => {
    const host = req.headers.host.split(':')[0];
    var drawbox;
    if (host == process.env.CLEAN_HOST) {
        drawbox = await db.getDrawboxByHost(req.query.domain);
    } else {
        drawbox = await db.getDrawboxByHost(host);
    }
    if (!drawbox) {
        return res.status(404).json({ error: 'Drawbox not found', success: false });
    }
    const userDir = path.join('users', drawbox.name, 'images');
    const id = req.params.id;
    var image = await db.getEntry(drawbox.id, id);
    const filePath = path.join(userDir, image.name);

    // Check if the file exists
    if (fs.existsSync(filePath)) {
        res.sendFile(path.resolve(filePath));
    } else {
        res.status(404).json({ error: 'Image not found', success: false });
    }
});

app.get('/auth', sameSiteMiddleware, notLoggedInMiddleware, (req, res) => {
    res.render('auth', { title: 'Auth' });
});

app.post('/auth/login', sameSiteMiddleware, notLoggedInMiddleware, async (req, res) => {
    const { email, password } = req.body;
    if ((!email) || !password) {
        res.status(400).json({ error: 'Missing required fields', success: false });
        return;
    } else {
        try {
            const result = await db.loginUser(email, password);
            if (result.success) {
                res.cookie('authorization', result.jwt, { httpOnly: true, secure: true, domain: process.env.CLEAN_HOST });
                res.redirect('/dashboard');
            } else {
                res.status(400).json({ error: result.message, success: result.success });
            }
        } catch (error) {
            res.status(500).json({ error: JSON.parse(error) });
        }
    }
});

app.post('/auth/register', notLoggedInMiddleware, async (req, res) => {
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
                fs.ensureDirSync(path.join("users", username, "css"));
                fs.writeFileSync(path.join("users", username, "css", "index.css"), `
@font-face {
    font-family: 'pixelserif';
    src: url(/fonts/PIXEARG_.ttf);
}
body {
    font-family: "pixelserif", Courier, monospace;
    margin: 20px;
    background-color: black;
    color: #ffffff;
}
.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    background-color: #000080;
    border: 2px solid #ffffff;
}
.image-gallery {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
}
.image-container {
    background-color: #c0c0c0;
    padding: 8px;
    border: 2px outset #ffffff;
}
.image-name {
  margin: 0;
  padding: 0;
}
#deleteButton {
    background-color: #ff0000;
    color: #ffffff;
    border: 2px outset #ff0000;
    padding: 1px;
    cursor: pointer;
    font-family: "pixelserif", Courier, monospace;
}
button {
    padding: 5px 10px;
    margin: 5px;
    background-color: #c0c0c0;
    color: #000000;
    border: 2px outset #ffffff;
    font-family: "pixelserif", Courier, monospace;
    cursor: pointer;
}
button:hover {
    border-style: inset;
}
input {
    padding: 5px;
    margin: 5px 0;
    background-color: #000000;
    color: #00ff00;
    border: 2px inset #ffffff;
    font-family: "pixelserif", Courier, monospace;
}`);
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

app.get('/dashboard', sameSiteMiddleware, loggedInMiddleware, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    var drawbox = await db.getDrawboxById(req.user.id);
    drawbox.images = await db.getDrawboxEntries(await drawbox.id);
    var customStyles = fs.readFileSync(path.join('users', drawbox.name, 'css', 'index.css'), 'utf8');
    res.render('dashboard', { user: user, drawbox: drawbox, title: 'Dashboard', customStyles: customStyles });
});

app.get('/logout', sameSiteMiddleware, loggedInMiddleware, (req, res) => {
    res.clearCookie('authorization');
    res.redirect('/');
});

var captchaSolutions = {};

app.get('/captcha', async (req, res) => {
    const ip = req.ip;
    if (!captchaSolutions[ip]) {
        captchaSolutions[ip] = [];
    }

    if (captchaSolutions[ip].length >= 10) {
        captchaSolutions[ip].shift(); // Remove the oldest token if the cap is reached
    }

    const token = Math.random().toString(36).substring(2);
    const x = Math.floor(Math.random() * 10);
    const y = Math.floor(Math.random() * 10);
    const question = `${x} + ${y}`;
    const solution = (x + y).toString();
    captchaSolutions[ip].push({ token, solution });

    const captcha = { token, question };
    res.json(captcha);
});

function verifyCaptcha(req, token, solution) {
    const ip = req.ip;
    if (!captchaSolutions[ip]) {
        return false;
    }
    const index = captchaSolutions[ip].findIndex(captcha => captcha.token === token);
    if (index === -1) {
        return false;
    }
    const captcha = captchaSolutions[ip][index];
    if (captcha.solution === solution) {
        captchaSolutions[ip].splice(index, 1);
        console.log("Passed Captcha");
        return true;
    }
    console.log("Failed Captcha");
    return false;
}

app.post('/addEntry', async (req, res) => {
    const host = req.headers.host.split(':')[0];
    let drawbox;
    if (host == process.env.CLEAN_HOST) {
        drawbox = await db.getDrawboxById(req.body.id);
    } else {
        drawbox = await db.getDrawboxByHost(host);
    }
    if (!drawbox) {
        return res.status(404).json({ error: 'Drawbox gone poof! :P', success: false });
    }

    if (drawbox.captcha) {
        if (!verifyCaptcha(req, req.body.captchaToken, req.body.captchaAnswer)) {
            return res.status(400).json({ error: 'Invalid captcha solution', success: false });
        }
    }

    const userDir = path.join('users', drawbox.name, 'images');

    try {
        var description = await req.body.description;
        var creator = await req.body.creator;

        if (!drawbox.descriptions) {
            description = null;
        }
        if (!drawbox.usernames) {
            creator = null;
        }

        if (description && description.length > 50) {
            return res.status(400).json({ error: 'Description is too long', success: false });
        }

        if (creator && creator.length > 20) {
            return res.status(400).json({ error: 'Creator name is too long', success: false });
        }

        await fs.ensureDir(userDir);
        const totalImages = await db.getDrawboxEntryCount(drawbox.id);
        await db.addEntry(drawbox.id, `${totalImages + 1}.png`, creator, description);
        const imageBuffer = Buffer.from(req.body.image.split(',')[1], 'base64');
        const filename = (totalImages + 1) + '.png';
        const filePath = path.join(userDir, filename);
        await fs.writeFile(filePath, imageBuffer);

        await sharp(filePath)
            .resize(200, 200)
            .toFile(path.join(userDir, "resized-" + filename));
        await fs.rename(path.join(userDir, "resized-" + filename), path.join(userDir, filename));
        res.status(200).json({ message: 'Image uploaded and resized successfully!' });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/deleteImage/:id', loggedInMiddleware, async (req, res) => {
    const { id } = req.params;
    const user = req.user;

    try {
        const drawbox = await db.getDrawboxById(user.id);
        if (!drawbox) {
            return res.status(404).json({ error: 'Drawbox not found', success: false });
        }

        var image = await db.getEntry(drawbox.id, id);

        const userDir = path.join('users', drawbox.name, 'images');
        const filePath = path.join(userDir, image.name);

        if (fs.existsSync(filePath)) {
            await fs.remove(filePath);
            await db.deleteEntry(drawbox.id, id);
            res.status(200).json({ message: 'Image deleted successfully!', success: true });
        } else {
            res.status(404).json({ error: 'Image not found', success: false });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message, success: false });
    }
});

app.post('/setConfig', sameSiteMiddleware, loggedInMiddleware, async (req, res) => {
    const { domain, captcha, color, backgroundColor, creators, descriptions } = req.body;
    const userId = req.user.id;

    try {
        const updateDomainQuery = `UPDATE drawboxes SET domain = ? WHERE userID = ?`;
        await db.db.run(updateDomainQuery, [domain, userId]);

        const updateCaptchaQuery = `UPDATE drawboxes SET captcha = ? WHERE userID = ?`;
        await db.db.run(updateCaptchaQuery, [captcha ? 1 : 0, userId]);

        await db.changeDrawboxColor(userId, backgroundColor, color);

        const updateCreatorsQuery = `UPDATE drawboxes SET usernames = ? WHERE userID = ?`;
        await db.db.run(updateCreatorsQuery, [creators ? 1 : 0, userId]);

        const updateDescriptionsQuery = `UPDATE drawboxes SET descriptions = ? WHERE userID = ?`;
        await db.db.run(updateDescriptionsQuery, [descriptions ? 1 : 0, userId]);

        res.redirect('/dashboard?message=Configuration updated successfully! :3');
    } catch (error) {
        res.redirect('/dashboard?message=An error occurred while updating the configuration. Please try again later.');
    }
});


app.post('/setCustomStyles', sameSiteMiddleware, loggedInMiddleware, async (req, res) => {
    const { customStyles } = req.body;
    const user = await db.getUserById(req.user.id);
    try {
        const cssSize = Buffer.byteLength(customStyles, 'utf8');
        if (cssSize > 5 * 1024) {
            return res.redirect("/dashboard?message=CSS exceeds 5KB limit. Try making your CSS smaller! We're sorry. D:");
        }
        const userDir = path.join('users', user.username, 'css');
        await fs.writeFile(path.join(userDir, 'index.css'), customStyles);
        res.redirect('/dashboard?message=CSS updated successfully! :3');
    } catch (error) {
        res.status(500).json({ error: error.message, success: false });
    }
});

app.get('/retrieveCustomStyles/:id', async (req, res) => {
    db.getDrawboxById(req.params.id).then((drawbox) => {
        if (!drawbox) {
            return res.status(404).json({ error: 'Drawbox not found', success: false });
        }
        const customStyles = fs.readFileSync(path.join('users', drawbox.name, 'css', 'index.css'), 'utf8');
        res.send(customStyles);
    });
});

fs.ensureDirSync('users');

// Start the server
app.listen(port, () => {
    console.log(`PoyoBook service running at http://localhost:${port}`);
});