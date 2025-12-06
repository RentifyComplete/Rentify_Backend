// models/User.js - UPDATED with personalDetails schema
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Basic user info
  name: { 
    type: String,
    trim: true
  },
  
  email: { 
    type: String, 
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      'Please enter a valid email address'
    ]
  },
  
  password: { 
    type: String, 
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },

  // User type
  userType: {
    type: String,
    enum: ['tenant', 'owner', 'admin'],
    default: 'tenant'
  },

  // Phone number (root level - for backward compatibility)
  phone: {
    type: String,
    trim: true
  },

  // ⭐ NEW: Personal Details Object
  personalDetails: {
    fullName: {
      type: String,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    dateOfBirth: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    }
  },

  // Profile image
  profileImage: {
    type: String
  },

  // ⭐ Bank Details for Property Owners (for Razorpay Route)
  bankDetails: {
    accountNumber: {
      type: String,
      trim: true
    },
    ifsc: {
      type: String,
      uppercase: true,
      trim: true
    },
    accountHolderName: {
      type: String,
      trim: true
    },
    verifiedAt: {
      type: Date
    }
  },

  // ⭐ Razorpay Integration Fields
  razorpayContactId: {
    type: String,
    trim: true
  },
  
  razorpayFundAccountId: {
    type: String,
    trim: true
  },

  // Account status
  isVerified: {
    type: Boolean,
    default: false
  },

  isActive: {
    type: Boolean,
    default: true
  },

  // OTP system for password reset
  otp: { 
    type: String, 
    default: null 
  },
  
  otpExpires: { 
    type: Date, 
    default: null 
  },

  // Last login tracking
  lastLogin: {
    type: Date
  },

  // Failed login attempts (for security)
  failedLoginAttempts: {
    type: Number,
    default: 0
  },

  lockUntil: {
    type: Date
  }
}, { 
  timestamps: true
});

// Indexes for better query performance
userSchema.index({ email: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ razorpayFundAccountId: 1 });

// Virtual field to check if account is locked
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual field to check if bank details are complete
userSchema.virtual('hasBankDetails').get(function() {
  return !!(
    this.bankDetails?.accountNumber && 
    this.bankDetails?.ifsc && 
    this.bankDetails?.accountHolderName
  );
});

// Virtual field to check if Razorpay is set up
userSchema.virtual('hasRazorpaySetup').get(function() {
  return !!(this.razorpayContactId && this.razorpayFundAccountId);
});

// Method to increment failed login attempts
userSchema.methods.incrementLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { failedLoginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  const updates = { $inc: { failedLoginAttempts: 1 } };
  const maxAttempts = 5;
  
  if (this.failedLoginAttempts + 1 >= maxAttempts) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts after successful login
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { failedLoginAttempts: 0, lastLogin: Date.now() },
    $unset: { lockUntil: 1 }
  });
};

// Pre-save middleware to clean up expired OTPs
userSchema.pre('save', function(next) {
  if (this.otpExpires && new Date() > this.otpExpires) {
    this.otp = null;
    this.otpExpires = null;
  }
  next();
});

// Static method to clean up all expired OTPs
userSchema.statics.cleanupExpiredOTPs = async function() {
  try {
    const result = await this.updateMany(
      { otpExpires: { $lt: new Date() } },
      { $set: { otp: null, otpExpires: null } }
    );
    console.log(`🧹 Cleaned up ${result.modifiedCount} expired OTPs`);
    return result;
  } catch (error) {
    console.error('❌ Error cleaning up OTPs:', error);
  }
};

// Method to sanitize user data before sending to client
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  
  // Remove sensitive fields
  delete userObject.password;
  delete userObject.otp;
  delete userObject.otpExpires;
  delete userObject.failedLoginAttempts;
  delete userObject.lockUntil;
  delete userObject.__v;
  
  // ⭐ Only show partial bank account number for security
  if (userObject.bankDetails?.accountNumber) {
    const accNum = userObject.bankDetails.accountNumber;
    userObject.bankDetails.accountNumber = 'XXXX' + accNum.slice(-4);
  }
  
  return userObject;
};

const User = mongoose.model('User', userSchema);

module.exports = User;