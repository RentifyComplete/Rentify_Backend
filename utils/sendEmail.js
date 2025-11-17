const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "rentify085@gmail.com",
    pass: "your-app-password" // IMPORTANT: Gmail App Password only
  }
});

async function sendEmail(to, subject, text) {
  await transporter.sendMail({
    from: "rentify085@gmail.com",
    to,
    subject,
    text
  });
}

module.exports = sendEmail;
