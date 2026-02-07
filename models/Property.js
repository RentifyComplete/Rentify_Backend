// ========================================
// FIXED PROPERTY MODEL - WITH AGREEMENT URL
// File: models/Property.js
// ✅ Added 'agreementUrl' field
// ✅ Added 'ownerName' field
// ✅ Added 'signatureUrl' field
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
    rooms: Number, // ⭐ For PG room count
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
    
    // ⭐⭐⭐ NEW FIELDS FOR AGREEMENTS ⭐⭐⭐
    ownerName: {
      type: String,
      default: null
    },
    signatureUrl: {
      type: String,
      default: null
    },
    agreementUrl: {
      type: String,
      default: null
    },
    agreementGeneratedAt: {
      type: Date,
      default: null
    },
    // ⭐⭐⭐ END NEW FIELDS ⭐⭐⭐
    
    // ⭐ Service Charge/Subscription Fields
    serviceDueDate: { 
      type: Date, 
      default: function() {
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
      default: Date.now
    },
    monthlyServiceCharge: {
      type: Number,
      required: true,
      default: 18
    },
    servicePaymentHistory: [paymentHistorySchema],
    gracePeriodEndsAt: { 
      type: Date,
      default: null
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
    // ⭐ FIXED: Prioritize 'rooms' over 'beds' for PG
    if (this.rooms) {
      charge = this.rooms * RATE_PER_UNIT;
    } else if (this.beds) {
      charge = this.beds * RATE_PER_UNIT;
    }
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
    return 'due';
  } else if (daysUntilDue >= -10) {
    return 'overdue';
  } else {
    return 'suspended';
  }
};

// ⭐ METHOD: Update payment and extend service date
propertySchema.methods.recordPayment = async function(paymentData) {
  console.log('🔍 recordPayment called with:', JSON.stringify(paymentData, null, 2));
  
  if (!paymentData.amount || !paymentData.monthsPaid) {
    throw new Error(`Missing required fields: amount=${paymentData.amount}, monthsPaid=${paymentData.monthsPaid}`);
  }
  
  const amount = Number(paymentData.amount);
  const monthsPaid = Number(paymentData.monthsPaid);
  const paymentId = String(paymentData.paymentId || '');
  const orderId = String(paymentData.orderId || '');
  
  console.log('💰 Validated amount:', amount);
  console.log('📅 Validated monthsPaid:', monthsPaid);
  
  if (isNaN(amount) || isNaN(monthsPaid) || amount <= 0 || monthsPaid <= 0) {
    throw new Error(`Invalid payment data: amount=${amount}, monthsPaid=${monthsPaid}`);
  }
  
  const currentDueDate = this.serviceDueDate || new Date();
  const now = new Date();
  const baseDate = currentDueDate > now ? currentDueDate : now;
  
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
  
  const validUntil = new Date(newDueDate);
  
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
  
  this.servicePaymentHistory.push(paymentEntry);
  
  this.serviceDueDate = newDueDate;
  this.serviceStatus = 'active';
  this.lastServicePayment = new Date();
  this.isActive = true;
  this.gracePeriodEndsAt = null;
  this.suspendedAt = null;
  this.suspensionReason = null;
  
  console.log('✅ Property updated, saving...');
  
  const saved = await this.save();
  
  console.log('✅ Property saved successfully');
  console.log('📊 Verified payment count:', saved.servicePaymentHistory.length);
  
  return saved;
};

// ========================================
// STATIC METHODS
// ========================================

propertySchema.statics.findPropertiesNeedingUpdate = async function() {
  const now = new Date();
  
  const properties = await this.find({
    serviceDueDate: { $lt: now },
    serviceStatus: { $ne: 'suspended' }
  });
  
  return properties;
};

propertySchema.statics.suspendOverdueProperties = async function() {
  const now = new Date();
  const gracePeriodEnd = new Date(now);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() - 10);
  
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

propertySchema.statics.updateAllStatuses = async function() {
  console.log('🔄 Updating all property statuses...');
  
  const now = new Date();
  
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
  
  await this.updateMany(
    {
      serviceDueDate: { $lt: now },
      serviceStatus: { $in: ['active', 'due'] }
    },
    { $set: { serviceStatus: 'overdue' } }
  );
  
  await this.suspendOverdueProperties();
  
  console.log('✅ All property statuses updated');
};

module.exports = mongoose.model('Property', propertySchema, 'properties');
