const sqlite3 = require('sqlite3').verbose();
const { on } = require('events');
const fs = require('fs');
const path = require('path');
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
    admin INTEGER NOT NULL DEFAULT 0)`);

    // Create drawboxes table
    db.run(`CREATE TABLE IF NOT EXISTS guestbooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER NOT NULL,
    name TEXT UNIQUE NOT NULL,
    domain TEXT UNIQUE NOT NULL,
    views INTEGER DEFAULT 0,
    totalMessages INTEGER DEFAULT 0,
    tier INTEGER DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userID) REFERENCES users(id))`);

    // Create messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guestbookID INTEGER NOT NULL,
    name TEXT DEFAULT 'Anonymous',
    website TEXT,
    message TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guestbookID) REFERENCES guestbooks(id))`);
    
    // Create drawboxes table
    db.run(`CREATE TABLE IF NOT EXISTS drawboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER NOT NULL,
    name TEXT UNIQUE NOT NULL,
    domain TEXT UNIQUE NOT NULL,
    views INTEGER DEFAULT 0,
    totalImages INTEGER DEFAULT 0,
    tier INTEGER DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userID) REFERENCES users(id))`);

    // Create images table
    db.run(`CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawboxID INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
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
            const guestbookQuery = `INSERT INTO guestbooks (userID, name, domain) VALUES (?, ?, ?)`;
            db.run(guestbookQuery, [userId, username, `${username}.${process.env.SHORT_HOST}`], function (err) {
                if (err) {
                    return reject({ success: false, message: err.message });
                }
                console.log(`Guestbook created for user ID: ${userId}`);
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
            resolve(row.id);
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

function getMessages(guestbookID) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM messages WHERE guestbookID = ?`;
        db.all(query, [guestbookID], (err, rows) => {
            if (err) {
                reject(err);
            }
            resolve(rows);
        });
    });
}

function getGuestbookByUsername(username) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM guestbooks WHERE name = ?`;
        db.get(query, [username], (err, row) => {
            if (err) {
                return reject(undefined);
            }
            resolve(row);
        });
    });
}

function addEntry(userId, username, website, message) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO messages (guestbookID, name, website, message) VALUES (?, ?, ?, ?)`;
        db.run(query, [userId, username, website, message], function (err) {
            if (err) {
                return reject(err);
            }
            resolve({ success: true, message: 'Entry added successfully' });
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
    getMessages,
    getGuestbookByUsername,
    addEntry
};