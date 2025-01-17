const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Create a new database file if it doesn't exist
const db = new sqlite3.Database('./poyobook.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    }
});

function setupDB() {
    // Create users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    apiKey TEXT DEFAULT NULL,
    tier INTEGER NOT NULL DEFAULT 0,
    modality TEXT DEFAULT 'drawbox',
    admin INTEGER NOT NULL DEFAULT 0)`);
    
    // Create drawboxes table
    db.run(`CREATE TABLE IF NOT EXISTS drawboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER NOT NULL,
    name TEXT UNIQUE NOT NULL,
    domain TEXT UNIQUE NOT NULL,
    views INTEGER DEFAULT 0,
    totalImages INTEGER DEFAULT 0,
    tier INTEGER DEFAULT 1,
    imageBrushColor TEXT DEFAULT '#000000',
    imageBackgroundColor TEXT DEFAULT '#FFFFFF',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
    captcha BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (userID) REFERENCES users(id))`);

    // Create images table
    db.run(`CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawboxID INTEGER NOT NULL,
    name TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (drawboxID) REFERENCES drawboxes(id))`);
}

setupDB();

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) {
                reject(err);
            }
            resolve(hash);
        });
    });
}

function createUser(username, email, password) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`;

        db.run(query, [username, email, password], function (err) {
            if (err) {
                return reject({ success: false, message: err.message });
            }

            const userId = this.lastID;
            console.log(`User created with ID: ${userId}`);
            const drawboxQuery = `INSERT INTO drawboxes (userID, name, domain) VALUES (?, ?, ?)`;
            db.run(drawboxQuery, [userId, username, `${username}.${process.env.CLEAN_HOST}`], function (err) {
                if (err) {
                    return reject({ success: false, message: err.message });
                }
                console.log(`Drawbox created for user ID: ${userId}`);
            });
            resolve({ success: true, jwt: jwt.sign({ id: userId }, process.env.AUTH_SECRET) });
        });
    });
}

function loginUser(userEmailOrName, password) {
    return new Promise((resolve, reject) => {
        const email = userEmailOrName.includes('@') ? userEmailOrName : null;
        if (!email) {
            const query = `SELECT * FROM users WHERE username = ?`;
            db.get(query, [userEmailOrName], async (err, row) => {
                if (err) {
                    reject(err);
                } else if (!row) {
                    resolve({ success: false, message: 'Invalid Credentials' });
                } else {
                    const match = await bcrypt.compare(password, row.password);
                    if (match) {
                        resolve({ success: true, jwt: jwt.sign({ id: row.id }, process.env.AUTH_SECRET) });
                    } else {
                        resolve({ success: false, message: 'Invalid Credentials' });
                    }
                }
            });
        } else {
            const query = `SELECT * FROM users WHERE email = ?`;
            db.get(query, [email], async (err, row) => {
                if (err) {
                    reject(err);
                } else if (!row) {
                    resolve({ success: false, message: 'User not found' });
                } else {
                    const match = await bcrypt.compare(password, row.password);
                    if (match) {
                        resolve({ success: true, jwt: jwt.sign({ id: row.id }, process.env.AUTH_SECRET) });
                    } else {
                        resolve({ success: false, message: 'Incorrect password' });
                    }
                }
            });
        }
    });
}

function getUserById(id) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM users WHERE id = ?`;
        db.get(query, [id], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row);
        });
    });
}

function getUserCount() {
    return new Promise((resolve, reject) => {
        const query = `SELECT COUNT(*) AS count FROM users`;
        db.get(query, (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row.count);
        });
    });
}

function getUserIdByUsername(username) {
    return new Promise((resolve, reject) => {
        const query = `SELECT id FROM users WHERE username = ?`;
        db.get(query, [username], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row);
        });
    });
}

function doesUserExist(id) {
    return new Promise((resolve, reject) => {
        const query = `SELECT COUNT(*) AS count FROM users WHERE id = ?`;
        db.get(query, [id], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row.count > 0);
        });
    });
}

function getDrawboxById(id) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM drawboxes WHERE id = ?`;
        db.get(query, [id], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row);
        });
    });
}

function getDrawboxEntries(drawboxId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM images WHERE drawboxID = ?`;
        db.all(query, [drawboxId], (err, rows) => {
            if (err) {
                reject(err);
            }
            resolve(rows);
        });
    });
}

function getDrawboxEntryCount(drawboxId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT COUNT(*) AS count FROM images WHERE drawboxID = ?`;
        db.get(query, [drawboxId], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row.count);
        });
    });
}

function getDrawboxByHost(host) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM drawboxes WHERE domain = ?`;
        db.get(query, [host], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row);
        });
    });
}

function addEntry(drawboxID, name) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO images (drawboxID, name) VALUES (?, ?)`;
        db.run(query, [drawboxID, name || `${this.lastID + 1}.png`], function (err) {
            if (err) {
                return reject({ success: false, message: err.message });
            }
            const imageId = this.lastID;
            db.run(`UPDATE drawboxes SET totalImages = totalImages + 1, lastUpdated = CURRENT_TIMESTAMP WHERE id = ?`, [drawboxID], (err) => {
                if (err) {
                    return reject({ success: false, message: err.message });
                }
                resolve({ success: true, id: imageId });
            });
        });
    });
}

function deleteEntry(drawboxID, entryID) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM images WHERE drawboxID = ? AND id = ?`;
        db.run(query, [drawboxID, entryID], function (err) {
            if (err) {
                return reject({ success: false, message: err.message });
            }
            db.run(`UPDATE drawboxes SET totalImages = totalImages - 1, lastUpdated = CURRENT_TIMESTAMP WHERE id = ?`, [drawboxID], (err) => {
                if (err) {
                    return reject({ success: false, message: err.message });
                }
                resolve({ success: true });
            });
        });
    });
}

function changeDrawboxColor(drawboxID, backgroundColor, color) {
    return new Promise((resolve, reject) => {
        const query = `UPDATE drawboxes SET imageBackgroundColor = ?, imageBrushColor = ? WHERE id = ?`;
        db.run(query, [backgroundColor, color, drawboxID], function (err) {
            if (err) {
                return reject({ success: false, message: err.message });
            }
            resolve({ success: true });
        });
    });
}

module.exports = {
    db,
    createUser,
    loginUser,
    hashPassword,
    getUserById,
    getUserIdByUsername,
    getUserCount,
    doesUserExist,
    getDrawboxById,
    getDrawboxEntries,
    getDrawboxByHost,
    addEntry,
    deleteEntry,
    getDrawboxEntryCount,
    changeDrawboxColor
};