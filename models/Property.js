// ========================================
// UPDATED PROPERTY MODEL - WITH MONTHLY SUBSCRIPTION
// File: models/property.js
// ✅ Adds monthly service charge tracking
// ✅ Auto-deactivation after 10-day grace period
// ========================================

const mongoose = require('mongoose');

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
    
    // ⭐ NEW: Service Charge/Subscription Fields
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
    servicePaymentHistory: [{
      amount: { type: Number, required: true },
      monthsPaid: { type: Number, required: true }, // 1, 3, 6, or 12
      paidAt: { type: Date, default: Date.now },
      paymentId: String,
      orderId: String,
      validUntil: Date, // When this payment expires
      status: {
        type: String,
        enum: ['completed', 'failed', 'pending'],
        default: 'completed'
      }
    }],
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

// ⭐ METHOD: Update payment and extend service date
propertySchema.methods.recordPayment = function(paymentData) {
  const { amount, monthsPaid, paymentId, orderId } = paymentData;
  
  // Calculate new due date
  const currentDueDate = this.serviceDueDate || new Date();
  const newDueDate = new Date(currentDueDate);
  newDueDate.setMonth(newDueDate.getMonth() + monthsPaid);
  
  // Add to payment history
  this.servicePaymentHistory.push({
    amount,
    monthsPaid,
    paidAt: new Date(),
    paymentId,
    orderId,
    validUntil: newDueDate,
    status: 'completed'
  });
  
  // Update fields
  this.serviceDueDate = newDueDate;
  this.serviceStatus = 'active';
  this.lastServicePayment = new Date();
  this.isActive = true;
  this.gracePeriodEndsAt = null;
  this.suspendedAt = null;
  this.suspensionReason = null;
  
  return this.save();
};

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

module.exports = mongoose.model('Property', propertySchema, 'properties');
