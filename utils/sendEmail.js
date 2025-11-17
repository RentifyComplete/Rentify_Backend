// utils/sendEmail.js
const nodemailer = require('nodemailer');

if (!process.env.GMAIL_APP_PASSWORD) {
  console.warn('⚠️ GMAIL_APP_PASSWORD not set. Emails will fail until you set it.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'rentify085@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD // must be Gmail App Password (16 chars)
  }
});

async function sendEmail(to, subject, htmlOrText) {
  try {
    const info = await transporter.sendMail({
      from: '"Rentify App" <rentify085@gmail.com>',
      to,
      subject,
      // permit either html or text; if html passed it will render
      html: htmlOrText,
    });
    console.log('✉️ Email sent:', info?.messageId || info);
    return info;
  } catch (err) {
    console.error('❌ sendEmail error:', err);
    throw err;
  }
}

module.exports = sendEmail;
