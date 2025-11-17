const express = require('express');
const router = express.Router();
const User = require('../models/user');
const sendEmail = require('../utils/sendEmail');
const bcrypt = require('bcryptjs');

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ------------------------
// SEND RESET OTP
router.post('/send-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email is required' });

    // Check user exists
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ success: false, message: 'Email not found' });

    // Generate OTP + expiry
    const otp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000;

    user.otp = otp;
    user.otpExpires = new Date(expires);
    await user.save();

    // Email
    const subject = 'Rentify — Password Reset OTP';
    const html = `
      <p>Hello,</p>
      <p>Your Rentify password reset OTP is:</p>
      <h2>${otp}</h2>
      <p>Valid for 5 minutes.</p>
    `;

    await sendEmail(user.email, subject, html);

    return res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('send-reset-otp error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------
// VERIFY OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ success: false, message: 'Email and OTP required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ success: false, message: 'Email not found' });

    if (!user.otp || !user.otpExpires)
      return res.status(400).json({ success: false, message: 'No OTP. Request new.' });

    if (user.otp !== otp)
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    if (new Date() > new Date(user.otpExpires))
      return res.status(400).json({ success: false, message: 'OTP expired' });

    user.otp = null;
    user.otpExpires = null;
    await user.save();

    return res.json({ success: true, message: 'OTP verified' });
  } catch (err) {
    console.error('verify-otp error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------
// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return res.status(400).json({ success: false, message: 'Missing fields' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ success: false, message: 'Email not found' });

    if (!user.otp || !user.otpExpires)
      return res.status(400).json({ success: false, message: 'No OTP found' });

    if (user.otp !== otp)
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    if (new Date() > new Date(user.otpExpires))
      return res.status(400).json({ success: false, message: 'OTP expired' });

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    return res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error('reset-password error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
