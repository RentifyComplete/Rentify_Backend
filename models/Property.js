// ========================================
// PROPERTY MODEL - WITH AGREEMENT SUPPORT
// File: models/Property.js
// ✅ Added 'rooms' field for PG properties
// ✅ Added agreement fields
// ✅ Monthly service charge tracking (PER PROPERTY)
// ✅ Payment history with proper validation
// ✅ FIX: Month-end safe due-date math (Jan 31 + 1 month = Feb 28/29, not Mar 3)
// ✅ FIX: Same Razorpay payment can never be recorded twice
// ========================================

const mongoose = require('mongoose');

// ⭐ Adds months without overflowing into the next month
function addMonthsClamped(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

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

    // ⭐⭐⭐ AGREEMENT FIELDS ⭐⭐⭐
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

    // ⭐ Service Charge/Subscription Fields (each property has its own)
    serviceDueDate: {
      type: Date,
      default: function () {
        // First month free, counted from when THIS property is created
        return addMonthsClamped(new Date(), 1);
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
// This is the ONE place the monthly charge is calculated — routes use it too.
propertySchema.methods.calculateServiceCharge = function () {
  const RATE_PER_UNIT = 18;
  let charge = RATE_PER_UNIT;

  if (this.type === 'PG') {
    // Prioritize 'rooms' over 'beds' for PG
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
propertySchema.methods.getPaymentStatus = function () {
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

// ⭐ METHOD: Record a payment for THIS property and extend only its due date
propertySchema.methods.recordPayment = async function (paymentData) {
  console.log('🔍 recordPayment called with:', JSON.stringify(paymentData, null, 2));

  if (!paymentData.amount || !paymentData.monthsPaid) {
    throw new Error(`Missing required fields: amount=${paymentData.amount}, monthsPaid=${paymentData.monthsPaid}`);
  }

  const amount = Number(paymentData.amount);
  const monthsPaid = Number(paymentData.monthsPaid);
  const paymentId = String(paymentData.paymentId || '');
  const orderId = String(paymentData.orderId || '');

  if (isNaN(amount) || isNaN(monthsPaid) || amount <= 0 || monthsPaid <= 0) {
    throw new Error(`Invalid payment data: amount=${amount}, monthsPaid=${monthsPaid}`);
  }

  // ⭐ FIX: Never record the same Razorpay payment twice
  // (e.g. app retries verify after a timeout → due date would be extended twice)
  if (paymentId && this.servicePaymentHistory.some(p => p.paymentId === paymentId)) {
    console.log('ℹ️ Payment already recorded, skipping:', paymentId);
    return this;
  }

  // Paid early → extend from current due date (no lost days)
  // Paid late  → extend from today
  const now = new Date();
  const currentDueDate = this.serviceDueDate || now;
  const baseDate = currentDueDate > now ? currentDueDate : now;

  // ⭐ FIX: month-end safe
  const newDueDate = addMonthsClamped(baseDate, monthsPaid);

  console.log('📅 Base date:', baseDate);
  console.log('📅 New due date:', newDueDate);

  this.servicePaymentHistory.push({
    amount,
    monthsPaid,
    paidAt: now,
    paymentId,
    orderId,
    validUntil: new Date(newDueDate),
    status: 'completed'
  });

  this.serviceDueDate = newDueDate;
  this.serviceStatus = 'active';
  this.lastServicePayment = now;
  this.isActive = true;
  this.gracePeriodEndsAt = null;
  this.suspendedAt = null;
  this.suspensionReason = null;

  const saved = await this.save();

  console.log('✅ Property saved. Payments in history:', saved.servicePaymentHistory.length);

  return saved;
};

// ========================================
// STATIC METHODS
// ========================================

propertySchema.statics.findPropertiesNeedingUpdate = async function () {
  const now = new Date();

  return this.find({
    serviceDueDate: { $lt: now },
    serviceStatus: { $ne: 'suspended' }
  });
};

propertySchema.statics.suspendOverdueProperties = async function () {
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

propertySchema.statics.updateAllStatuses = async function () {
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
