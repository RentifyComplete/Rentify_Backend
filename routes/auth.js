// routes/auth.js - FULLY CORRECTED VERSION WITH FIXED RESPONSE
const express = require('express');
const router = express.Router();
const User = require('../models/user');
const sendEmail = require('../utils/sendEmail');
const crypto = require('crypto');

// Helper function to hash password with SHA256 (matches Flutter)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ⭐ FULLY FIXED: GET owner details endpoint - Extracts phone from personalDetails
// This endpoint is called by Flutter app to fetch owner phone number
// Usage: GET /api/auth/owner/:ownerId
router.get('/owner/:ownerId', async (req, res) => {
  try {
    console.log('🔍 Fetching owner details:', req.params.ownerId);

    const owner = await User.findById(req.params.ownerId).select(
      'name email phone phoneNumber personalDetails address city'
    );

    if (!owner) {
      console.log('⚠️ Owner not found:', req.params.ownerId);
      return res.status(404).json({
        success: false,
        message: 'Owner not found'
      });
    }

    console.log('📋 Raw owner object from DB:', JSON.stringify(owner, null, 2));

    // ⭐ EXTRACT PHONE NUMBER - Check all possible locations
    let phoneNumber = null;
    let ownerName = null;

    // 1. Check root level phone fields
    if (owner.phone) {
      phoneNumber = owner.phone;
      console.log('✅ Phone found at owner.phone:', phoneNumber);
    } else if (owner.phoneNumber) {
      phoneNumber = owner.phoneNumber;
      console.log('✅ Phone found at owner.phoneNumber:', phoneNumber);
    }
    
    // 2. Check personalDetails object (EXPLICIT checking)
    if (!phoneNumber && owner.personalDetails) {
      console.log('🔍 Checking personalDetails:', JSON.stringify(owner.personalDetails, null, 2));
      
      if (owner.personalDetails.phone) {
        phoneNumber = owner.personalDetails.phone;
        console.log('✅ Phone found in personalDetails.phone:', phoneNumber);
      } else if (owner.personalDetails.phoneNumber) {
        phoneNumber = owner.personalDetails.phoneNumber;
        console.log('✅ Phone found in personalDetails.phoneNumber:', phoneNumber);
      } else if (owner.personalDetails.mobile) {
        phoneNumber = owner.personalDetails.mobile;
        console.log('✅ Phone found in personalDetails.mobile:', phoneNumber);
      } else if (owner.personalDetails.mobileNumber) {
        phoneNumber = owner.personalDetails.mobileNumber;
        console.log('✅ Phone found in personalDetails.mobileNumber:', phoneNumber);
      } else if (owner.personalDetails.contactNumber) {
        phoneNumber = owner.personalDetails.contactNumber;
        console.log('✅ Phone found in personalDetails.contactNumber:', phoneNumber);
      } else {
        console.log('⚠️ No phone found in personalDetails');
      }
    }

    if (!phoneNumber) {
      console.log('❌ NO PHONE NUMBER FOUND ANYWHERE!');
    }

    // 3. Extract owner name
    if (owner.name) {
      ownerName = owner.name;
    } else if (owner.personalDetails && owner.personalDetails.fullName) {
      ownerName = owner.personalDetails.fullName;
    } else if (owner.personalDetails && owner.personalDetails.name) {
      ownerName = owner.personalDetails.name;
    } else {
      ownerName = 'Property Owner';
    }

    console.log('📝 Final owner name:', ownerName);
    console.log('📞 Final owner phone:', phoneNumber);

    // ⭐ FIXED: Return as "owner" not "data" to match Flutter expectations
    const ownerData = {
      _id: owner._id,
      name: ownerName,
      email: owner.email,
      phoneNumber: phoneNumber,  // Primary field
      phone: phoneNumber,        // Fallback field
      address: owner.address || null,
      city: owner.city || null,
    };

    console.log('✅ Sending owner data:', JSON.stringify(ownerData, null, 2));

    // ⭐ CRITICAL FIX: Return as "owner" to match Flutter code
    res.status(200).json({
      success: true,
      owner: ownerData  // Changed from "data" to "owner"
    });
  } catch (error) {
    console.error('❌ Error fetching owner:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch owner',
      error: error.message
    });
  }
});

// ------------------------
// SEND RESET OTP
// ------------------------
router.post('/send-reset-otp', async (req, res) => {
  try {
    console.log('📧 Send OTP request:', req.body);
    
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'No account found with this email address' 
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    user.otp = otp;
    user.otpExpires = expiresAt;
    await user.save();

    console.log(`✅ OTP generated for ${email}: ${otp} (expires: ${expiresAt.toISOString()})`);

    const subject = 'Rentify — Password Reset OTP';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
          .otp-box { background: white; border: 2px solid #4CAF50; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4CAF50; letter-spacing: 5px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏠 Rentify Password Reset</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>You requested to reset your Rentify account password. Use the OTP below to proceed:</p>
            
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>
            
            <p><strong>⏰ This OTP is valid for 5 minutes only.</strong></p>
            <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
            
            <div class="footer">
              <p>© ${new Date().getFullYear()} Rentify. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendEmail(user.email, subject, html);
    console.log(`✅ OTP email sent to ${email}`);

    return res.json({ 
      success: true, 
      message: 'OTP sent to your email address. Please check your inbox.' 
    });

  } catch (err) {
    console.error('❌ send-reset-otp error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send OTP. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ------------------------
// VERIFY OTP
// ------------------------
router.post('/verify-otp', async (req, res) => {
  try {
    console.log('🔍 Verify OTP request:', req.body);
    
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Email not found' 
      });
    }

    if (!user.otp || !user.otpExpires) {
      return res.status(400).json({ 
        success: false, 
        message: 'No OTP found. Please request a new one.' 
      });
    }

    if (new Date() > new Date(user.otpExpires)) {
      user.otp = null;
      user.otpExpires = null;
      await user.save();
      
      return res.status(400).json({ 
        success: false, 
        message: 'OTP has expired. Please request a new one.' 
      });
    }

    if (user.otp !== otp.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP. Please check and try again.' 
      });
    }

    console.log(`✅ OTP verified for ${email}`);
    
    return res.json({ 
      success: true, 
      message: 'OTP verified successfully. You can now reset your password.' 
    });

  } catch (err) {
    console.error('❌ verify-otp error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to verify OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ------------------------
// RESET PASSWORD
// ------------------------
router.post('/reset-password', async (req, res) => {
  try {
    console.log('🔐 Reset password request for:', req.body.email);
    
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, OTP, and new password are required' 
      });
    }

    if (newPassword.trim().length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Email not found' 
      });
    }

    if (!user.otp || !user.otpExpires) {
      return res.status(400).json({ 
        success: false, 
        message: 'No OTP found. Please request a new one.' 
      });
    }

    if (user.otp !== otp.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP' 
      });
    }

    if (new Date() > new Date(user.otpExpires)) {
      user.otp = null;
      user.otpExpires = null;
      await user.save();
      
      return res.status(400).json({ 
        success: false, 
        message: 'OTP has expired. Please request a new one.' 
      });
    }

    const hashedPassword = hashPassword(newPassword.trim());
    
    console.log(`📝 New password hash: ${hashedPassword.substring(0, 10)}...`);
    
    user.password = hashedPassword;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    console.log(`✅ Password reset successful for ${email}`);

    return res.json({ 
      success: true, 
      message: 'Password reset successfully. You can now login with your new password.' 
    });

  } catch (err) {
    console.error('❌ reset-password error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to reset password. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ------------------------
// DEBUG ROUTE (Development only)
// ------------------------
if (process.env.NODE_ENV === 'development') {
  router.get('/debug-users', async (req, res) => {
    try {
      const users = await User.find({}, 'email password otp otpExpires createdAt');
      res.json({
        success: true,
        count: users.length,
        users: users.map(u => ({
          email: u.email,
          passwordHash: u.password ? u.password.substring(0, 20) + '...' : 'N/A',
          hasOTP: !!u.otp,
          otp: u.otp,
          otpExpires: u.otpExpires,
          isExpired: u.otpExpires ? new Date() > new Date(u.otpExpires) : null,
          createdAt: u.createdAt
        }))
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = router;