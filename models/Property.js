// ========================================
// FINAL PROPERTY MODEL - COMPLETE & FIXED
// File: models/Property.js
// ✅ Monthly service charge tracking
// ✅ Payment history with proper validation
// ✅ Auto-deactivation after grace period
// ✅ Fixed recordPayment method
// ========================================

const mongoose = require('mongoose');

// ⭐ Define payment history subdocument schema explicitly
const paymentHistorySchema = new mongoose.Schema({
  amount: { 
    type: Number, 
    required: [true, 'Payment amount is required']
  },
  monthsPaid: { 
    type: Number, 
    required: [true, 'Months paid is required']
  },
  paidAt: { 
    type: Date, 
    default: Date.now 
  },
  paymentId: { 
    type: String,
    default: ''
  },
  orderId: { 
    type: String,
    default: ''
  },
  validUntil: { 
    type: Date 
  },
  status: {
    type: String,
    enum: ['completed', 'failed', 'pending'],
    default: 'completed'
  }
}, { _id: true });

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    location: { type: String, required: true },
    price: { type: String, required: true },
    type: { type: String, required: true },
    bhk: String,
    beds: Number,
    amenities: [String],
    description: { type: String, required: true },
    address: String,
    city: String,
    state: String,
    zipCode: String,
    ownerId: { type: String, required: true },
    images: [String],
    rating: { type: Number, default: 4.5 },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    
    // ⭐ Service Charge/Subscription Fields
    serviceDueDate: { 
      type: Date, 
      default: function() {
        // Default: 30 days from property creation (first payment = 1 month)
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    },
    serviceStatus: { 
      type: String, 
      enum: ['active', 'due', 'overdue', 'suspended'],
      default: 'active'
    },
    lastServicePayment: { 
      type: Date,
      default: Date.now // Set to now when property is created
    },
    monthlyServiceCharge: {
      type: Number,
      required: true,
      default: 18 // Base charge per bed/bhk
    },
    servicePaymentHistory: [paymentHistorySchema], // ⭐ Use explicit schema
    gracePeriodEndsAt: { 
      type: Date,
      default: null // Set when payment becomes overdue
    },
    autoRenewal: { 
      type: Boolean, 
      default: false 
    },
    suspendedAt: {
      type: Date,
      default: null
    },
    suspensionReason: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

// ========================================
// INSTANCE METHODS
// ========================================

// ⭐ METHOD: Calculate service charge based on property type
propertySchema.methods.calculateServiceCharge = function() {
  const RATE_PER_UNIT = 18;
  let charge = RATE_PER_UNIT;
  
  if (this.type === 'PG') {
    charge = (this.beds || 1) * RATE_PER_UNIT;
  } else if (this.type === 'Flat' || this.type === 'Apartment') {
    if (this.bhk) {
      const match = this.bhk.match(/(\d+)/);
      if (match) {
        charge = parseInt(match[1]) * RATE_PER_UNIT;
      }
    }
  }
  
  return Math.max(charge, RATE_PER_UNIT);
};

// ⭐ METHOD: Check if payment is due/overdue
propertySchema.methods.getPaymentStatus = function() {
  const now = new Date();
  const dueDate = this.serviceDueDate;
  
  if (!dueDate) {
    return 'active';
  }
  
  const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilDue > 15) {
    return 'active';
  } else if (daysUntilDue > 0) {
    return 'due'; // Payment due soon (within 15 days)
  } else if (daysUntilDue >= -10) {
    return 'overdue'; // Within 10-day grace period
  } else {
    return 'suspended'; // Grace period ended
  }
};

// ⭐ METHOD: Update payment and extend service date - FIXED VERSION
propertySchema.methods.recordPayment = async function(paymentData) {
  console.log('🔍 recordPayment called with:', JSON.stringify(paymentData, null, 2));
  
  // Validate required fields
  if (!paymentData.amount || !paymentData.monthsPaid) {
    throw new Error(`Missing required fields: amount=${paymentData.amount}, monthsPaid=${paymentData.monthsPaid}`);
  }
  
  // Explicitly extract and validate fields
  const amount = Number(paymentData.amount);
  const monthsPaid = Number(paymentData.monthsPaid);
  const paymentId = String(paymentData.paymentId || '');
  const orderId = String(paymentData.orderId || '');
  
  console.log('💰 Validated amount:', amount);
  console.log('📅 Validated monthsPaid:', monthsPaid);
  
  if (isNaN(amount) || isNaN(monthsPaid) || amount <= 0 || monthsPaid <= 0) {
    throw new Error(`Invalid payment data: amount=${amount}, monthsPaid=${monthsPaid}`);
  }
  
  // Calculate new due date
  const currentDueDate = this.serviceDueDate || new Date();
  const now = new Date();
  
  // ⭐ If current due date is in the past, start from now
  const baseDate = currentDueDate > now ? currentDueDate : now;
  
  // ⭐ CRITICAL FIX: Use exact month calculation to avoid date issues
  const newDueDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth() + monthsPaid,
    baseDate.getDate(),
    baseDate.getHours(),
    baseDate.getMinutes(),
    baseDate.getSeconds()
  );
  
  console.log('📅 Base date:', baseDate);
  console.log('📅 New due date:', newDueDate);
  
  // Calculate valid until date
  const validUntil = new Date(newDueDate);
  
  // Create payment history entry with explicit field assignment
  const paymentEntry = {
    amount: amount,
    monthsPaid: monthsPaid,
    paidAt: new Date(),
    paymentId: paymentId,
    orderId: orderId,
    validUntil: validUntil,
    status: 'completed'
  };
  
  console.log('💾 Payment entry to save:', JSON.stringify(paymentEntry, null, 2));
  
  // Add to payment history
  this.servicePaymentHistory.push(paymentEntry);
  
  // Update property fields
  this.serviceDueDate = newDueDate;
  this.serviceStatus = 'active';
  this.lastServicePayment = new Date();
  this.isActive = true;
  this.gracePeriodEndsAt = null;
  this.suspendedAt = null;
  this.suspensionReason = null;
  
  console.log('✅ Property updated, saving...');
  console.log('📊 Payment history length:', this.servicePaymentHistory.length);
  console.log('📊 Last entry:', JSON.stringify(this.servicePaymentHistory[this.servicePaymentHistory.length - 1], null, 2));
  
  // Save and return
  const saved = await this.save();
  
  console.log('✅ Property saved successfully');
  console.log('📊 Verified payment count:', saved.servicePaymentHistory.length);
  
  return saved;
};

// ========================================
// STATIC METHODS
// ========================================

// ⭐ STATIC METHOD: Find properties that need status update
propertySchema.statics.findPropertiesNeedingUpdate = async function() {
  const now = new Date();
  
  // Find properties where due date has passed
  const properties = await this.find({
    serviceDueDate: { $lt: now },
    serviceStatus: { $ne: 'suspended' }
  });
  
  return properties;
};

// ⭐ STATIC METHOD: Auto-suspend overdue properties
propertySchema.statics.suspendOverdueProperties = async function() {
  const now = new Date();
  const gracePeriodEnd = new Date(now);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() - 10); // 10 days ago
  
  const result = await this.updateMany(
    {
      serviceDueDate: { $lt: gracePeriodEnd },
      serviceStatus: { $ne: 'suspended' },
      isActive: true
    },
    {
      $set: {
        serviceStatus: 'suspended',
        isActive: false,
        suspendedAt: now,
        suspensionReason: 'Service charge payment overdue (10+ days)',
        gracePeriodEndsAt: now
      }
    }
  );
  
  console.log(`⏸️ Suspended ${result.modifiedCount} properties for non-payment`);
  return result;
};

// ⭐ STATIC METHOD: Update all property statuses (for cron job)
propertySchema.statics.updateAllStatuses = async function() {
  console.log('🔄 Updating all property statuses...');
  
  const now = new Date();
  
  // Update 'active' properties that are now 'due'
  await this.updateMany(
    {
      serviceDueDate: { 
        $lte: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
        $gt: now
      },
      serviceStatus: 'active'
    },
    { $set: { serviceStatus: 'due' } }
  );
  
  // Update 'due' properties that are now 'overdue'
  await this.updateMany(
    {
      serviceDueDate: { $lt: now },
      serviceStatus: { $in: ['active', 'due'] }
    },
    { $set: { serviceStatus: 'overdue' } }
  );
  
  // Suspend properties past grace period
  await this.suspendOverdueProperties();
  
  console.log('✅ All property statuses updated');
};

module.exports = mongoose.model('Property', propertySchema, 'properties');
