// routes/auth.js
const express = require('express');
const router = express.Router();
const User = require('../Modals/user'); // use your existing model
const sendEmail = require('../utils/sendEmail');
const bcrypt = require('bcryptjs');

// Helpers
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ------------------------
// SEND RESET OTP
// Endpoint: POST /api/auth/send-reset-otp
// Body: { email: "user@example.com" }
router.post('/send-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    // Check if user exists
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'Email not found' });

    // Generate OTP and expiry
    const otp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Save into user document (overwrites any previous otp)
    user.otp = otp;
    user.otpExpires = new Date(expires);
    await user.save();

    // Send OTP via email
    const subject = 'Rentify / RentOkPG — Password Reset OTP';
    const html = `
      <p>Hello,</p>
      <p>Your password reset OTP is: <strong>${otp}</strong></p>
      <p>This OTP is valid for 5 minutes.</p>
      <p>If you did not request this, please ignore.</p>
    `;

    await sendEmail(user.email, subject, html);

    console.log(`✅ OTP sent to ${user.email}: ${otp}`);
    return res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('❌ send-reset-otp error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ------------------------
// VERIFY OTP
// Endpoint: POST /api/auth/verify-otp
// Body: { email: "...", otp: "123456" }
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'Email not found' });

    if (!user.otp || !user.otpExpires) {
      return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    // OTP valid — clear it but you may keep it until reset completes.
    // We'll clear it here to prevent reuse.
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    return res.json({ success: true, message: 'OTP verified' });
  } catch (err) {
    console.error('❌ verify-otp error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ------------------------
// RESET PASSWORD
// Endpoint: POST /api/auth/reset-password
// Body: { email: "...", otp: "...", newPassword: "..." }
// This assumes you verify OTP first OR pass otp again here.
// We'll verify otp again to be safe.
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ success: false, message: 'Email, OTP and new password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'Email not found' });

    if (!user.otp || !user.otpExpires) {
      return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    // Hash the new password and store
    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;

    // Clear OTP fields
    user.otp = null;
    user.otpExpires = null;

    await user.save();

    return res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error('❌ reset-password error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;
