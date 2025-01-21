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
const multer = require('multer');

app.use(cookieParser());
app.use(bodyParser.json({ limit: '1mb' }));
app.set('views', 'views');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

var userBlacklist = ['admin', 'administrator', 'root', 'moderator', 'mod', 'staff', 'owner', 'developer', 'dev', 'owner', 'webmaster', 'host', 'support', 'contact', 'info', 'help', 'team', 'blog'];

function checkUsername(username) {
    const regex = /^[a-zA-Z0-9]+$/; // Regex to allow only alphanumeric characters (letters and numbers)
    if (username.includes(' ')) {
        return 'Username cannot contain spaces';
    } else if (username.length > 20) {
        return 'Username must have at max 20 characters';
    } else if (!regex.test(username)) {
        return 'Username must contain only letters and numbers';
    } else if (userBlacklist.includes(username)) {
        return 'Username is blacklisted, try again with a different username';
    } else {
        return false;
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
            return res.render('index', { title: 'Free drawboxes for everyone :3', drawboxEntries: await db.getIndexDrawboxEntries() });
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
    if (!await drawbox) {
        return res.status(404).json({ error: 'Drawbox not found', success: false });
    }
    const userDir = path.join('users', await drawbox.name, 'images');
    const id = req.params.id;
    var image = await db.getEntry(await drawbox.id, id);
    if (!await image) {
        return res.status(404).json({ error: 'Image not found', success: false });
    }
    const filePath = path.join(userDir, await image.name);

    // Check if the file exists
    if (fs.existsSync(filePath)) {
        res.sendFile(path.resolve(filePath));
    } else {
        res.status(404).json({ error: 'Image not found', success: false });
    }
});

app.get('/retrieveImage/:drawboxId/:id', async (req, res) => {
    const drawbox = await db.getDrawboxById(req.params.drawboxId);
    if (!drawbox) {
        return res.status(404).json({ error: 'Drawbox not found', success: false });
    }
    const userDir = path.join('users', await drawbox.name, 'images');
    const id = req.params.id;
    var image = await db.getEntry(await drawbox.id, id);
    const filePath = path.join(userDir, await image.name);

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

function resetDefaultStyles(username) {
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
.title {
    text-align: center;
    margin: 10px 0;
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
}
textarea {
    padding: 5px;
    margin: 5px 0;
    background-color: #000000;
    color: #00ff00;
    border: 2px inset #ffffff;
    font-family: "pixelserif", Courier, monospace;
}
`);
}

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
    if (usernameTest) {
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
                resetDefaultStyles(username);
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

app.get('/auth/recover', sameSiteMiddleware, notLoggedInMiddleware, (req, res) => {
    res.render('recover', { title: 'Recover Your Account >.<' });
});

app.post('/auth/recover', sameSiteMiddleware, notLoggedInMiddleware, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Missing required fields', success: false });
    }
    try {
        const result = await db.resetPassword(email);
        if (result.success) {
            res.redirect('/auth/?message=' + result.message);
        } else {
            res.redirect('/auth/recover?message=' + result.error);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/auth/recover/:token', sameSiteMiddleware, notLoggedInMiddleware, async (req, res) => {
    const token = req.params.token;
    jwt.verify(token, process.env.AUTH_SECRET, (err, decoded) => {
        if (err) {
            return res.redirect("/auth/?message=Invalid token, it might've expired! D:");
        } else {
            return res.render('reset', { title: 'Reset Your Password >.<', token: token });
        }
    });
});

app.post('/auth/recover/:token', sameSiteMiddleware, notLoggedInMiddleware, async (req, res) => {
    const token = req.params.token;
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: 'Missing required fields', success: false });
    }
    var decoded = jwt.verify(token, process.env.AUTH_SECRET);
    if (!decoded) {
        return res.status(400).json({ error: 'Invalid token', success: false });
    }
    try {
        const result = await db.changePasswordByEmail(decoded.email, password);
        if (result.success) {
            res.redirect('/auth/?message=' + result.message);
        } else {
            res.redirect('/auth/recover?message=' + result.error);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
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

function mapToClosestColor(pixel, color1, color2) {
    const distance = (c1, c2) =>
        Math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2 + (c1[2] - c2[2]) ** 2);

    const distanceToColor1 = distance(pixel, color1);
    const distanceToColor2 = distance(pixel, color2);

    return distanceToColor1 < distanceToColor2 ? [...color1, pixel[3]] : [...color2, pixel[3]];
}

// Set up multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 }, // 100 KB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'image/png') {
            return cb(new Error('Only PNG files are allowed!'), false);
        }
        cb(null, true);
    }
});

async function processImage(inputBuffer, outputPath, width, height, dbColor1, dbColor2) {
    try {
        // Parse colors from the database
        const color1 = dbColor1.match(/\w\w/g).map(hex => parseInt(hex, 16)); // [R, G, B]
        const color2 = dbColor2.match(/\w\w/g).map(hex => parseInt(hex, 16)); // [R, G, B]

        const image = sharp(inputBuffer)
            .resize(width, height, { kernel: 'nearest' }) // Resize with no anti-aliasing
            .raw() // Get raw pixel data
            .ensureAlpha();

        const { data, info } = await image.toBuffer({ resolveWithObject: true });

        // Map each pixel to the closest color
        const mappedData = Buffer.from(
            Array.from({ length: data.length / 4 }, (_, i) => {
                const offset = i * 4;
                const pixel = data.subarray(offset, offset + 4); // [R, G, B, A]
                const mappedPixel = mapToClosestColor(
                    [pixel[0], pixel[1], pixel[2], pixel[3]],
                    color1,
                    color2
                );
                return mappedPixel;
            }).flat()
        );

        // Write the output image with the remapped colors
        await sharp(mappedData, { raw: { width: info.width, height: info.height, channels: 4 } })
            .toFile(outputPath);

        console.log('Image processing complete:', outputPath);
        return true;
    } catch (error) {
        console.error('Error processing image:', error);
        return false;
    }
}

app.post('/addEntry', upload.single('image'), async (req, res) => {
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
        const name = totalImages + Math.random().toString(36).substring(2) + '.png';
        const newImageId = await db.addEntry(drawbox.id, `${name}.png`, creator, description);
        const filename = name + '.png';
        const filePath = path.join(userDir, filename);
        await fs.writeFile(filePath, req.file.buffer);

        const outputPath = path.join(userDir, 'processed_' + filename);
        const processed = await processImage(req.file.buffer, outputPath, 200, 200, drawbox.imageBrushColor, drawbox.imageBackgroundColor);
        if (!processed) {
            await db.deleteEntry(drawbox.id, newImageId);
            return res.status(500).json({ error: 'Error processing image', success: false });
        }

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

        var image = await db.getEntry(await drawbox.id, id);

        const userDir = path.join('users', await drawbox.name, 'images');
        const filePath = path.join(userDir, await image.name);

        if (fs.existsSync(filePath)) {
            await fs.remove(filePath);
            res.status(200).json({ message: 'Image deleted successfully!', success: true });
        } else {
            res.status(404).json({ error: 'Image not found', success: false });
        }
        await db.deleteEntry(drawbox.id, id);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message, success: false });
    }
});

app.post('/setConfig', sameSiteMiddleware, loggedInMiddleware, async (req, res) => {
    const { domain, captcha, color, backgroundColor, creators, descriptions } = req.body;
    const userId = req.user.id;

    try {
        if (domain && domain.includes(process.env.CLEAN_HOST) && domain != `${req.user.username}.${process.env.CLEAN_HOST}`) {
            return res.redirect(`/dashboard?message=Domain cannot be a ${process.env.CLEAN_HOST} subdomain! D: To claim back your subdomain reset it!`);
        }
        if (domain) {
            const updateDomainQuery = `UPDATE drawboxes SET domain = ? WHERE userID = ?`;
            await db.db.run(updateDomainQuery, [domain, userId]);
        }
        const updateCaptchaQuery = `UPDATE drawboxes SET captcha = ? WHERE userID = ?`;
        await db.db.run(updateCaptchaQuery, [captcha ? 1 : 0, userId]);

        await db.changeDrawboxColor(userId, backgroundColor, color);

        const updateCreatorsQuery = `UPDATE drawboxes SET usernames = ? WHERE userID = ?`;
        await db.db.run(updateCreatorsQuery, [creators ? 1 : 0, userId]);

        const updateDescriptionsQuery = `UPDATE drawboxes SET descriptions = ? WHERE userID = ?`;
        await db.db.run(updateDescriptionsQuery, [descriptions ? 1 : 0, userId]);

        res.redirect('/dashboard?message=Configuration updated successfully! :3');
    } catch (error) {
        console.log(error);
        res.redirect('/dashboard?message=An error occurred while updating the configuration. Please try again later.');
    }
});

app.post('/resetDomain', sameSiteMiddleware, loggedInMiddleware, async (req, res) => {
    const userId = req.user.id;
    const user = await db.getUserById(userId);
    try {
        const updateDomainQuery = `UPDATE drawboxes SET domain = ? WHERE userID = ?`;
        const newDomain = `${await user.username}.${process.env.CLEAN_HOST}`;
        console.log(newDomain);
        await db.db.run(updateDomainQuery, [newDomain, userId]);
        res.redirect('/dashboard?message=Domain reset successfully! :3');
    } catch (error) {
        res.redirect('/dashboard?message=An error occurred while resetting the domain. Please try again later.');
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
    console.log(`PoyoBox service running at http://localhost:${port}`);
});