const nodemailer = require("nodemailer");

const sendEmail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USERNAME,  // rentify085@gmail.com
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Rentify Support" <${process.env.EMAIL_USERNAME}>`,
      to,
      subject,
      html,
    });

    console.log(`📩 Email sent to: ${to}`);
  } catch (error) {
    console.error("❌ Email send error:", error);
    throw error;
  }
};

module.exports = sendEmail;
