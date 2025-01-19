const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        pass: process.env.MAILER_PASSWORD,
        user: process.env.MAILER_ADDRESS,
    }
});


function sendRecoveryEmail(token, email) {

    const mailConfigurations = {

        // It should be a string of sender/server email
        from: process.env.MAILER_ALIAS,
        to: email,
        subject: 'PoyoBox.net - Password Recovery',
        text: `Haii! :3\nYou have recently requested a password recovery on PoyoBox.net!\nPlease follow the given link to recover your password. :D \nhttps://${process.env.CLEAN_HOST}/auth/recover/${token}\n Thanks!\n--Poyo!\nPD: The link will expire in 1h hehehe.`
    };

    transporter.sendMail(mailConfigurations, function (error) {
        if (error) throw Error(error);
        return console.log('Email Sent Successfully');
    });
}

module.exports = {
    sendRecoveryEmail
};