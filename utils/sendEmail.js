// utils/sendEmail.js
const nodemailer = require('nodemailer');

/**
 * Send email using Gmail SMTP
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @returns {Promise<void>}
 */
async function sendEmail(to, subject, html) {
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.GMAIL_APP_PASSWORD, // App password, not regular password
      },
    });

    // Email options
    const mailOptions = {
      from: `"Rentify" <${process.env.EMAIL_USERNAME}>`,
      to: to,
      subject: subject,
      html: html,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully:', {
      messageId: info.messageId,
      to: to,
      subject: subject
    });
    
    return info;
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

module.exports = sendEmail;