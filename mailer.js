const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        pass: process.env.MAILER_PASSWORD,
        user: process.env.MAILER_ADDRESS,
    }
});

module.exports = {};