// models/Booking.js
// ✅ FIXED: Booking Model with proper Map handling

const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    // -------------------- Core Relations --------------------
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    // -------------------- Tenant Snapshot --------------------
    tenantName: {
      type: String,
      required: true,
      trim: true
    },

    tenantEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },

    tenantPhone: {
      type: String,
      required: true,
      trim: true
    },

    // -------------------- Property Snapshot --------------------
    propertyTitle: {
      type: String,
      default: '',
      trim: true
    },

    propertyAddress: {
      type: String,
      default: '',
      trim: true
    },
    
    // ⭐ ADD THESE TWO FIELDS
    roomNumber: {
      type: String,
      default: null,
      trim: true
    },

    occupancyType: {
      type: String,
      default: 'Single',
      trim: true
    },
    // -------------------- Financials --------------------
    monthlyRent: {
      type: Number,
      required: true,
      min: 0
    },

    securityDeposit: {
      type: Number,
      required: true,
      min: 0
    },

    convenienceFee: {
      type: Number,
      default: 0,
      min: 0
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },

    // -------------------- Lease Info --------------------
    moveInDate: {
      type: Date,
      required: true
    },

    leaseDuration: {
      type: Number,
      required: true,
      min: 1
    },

    notes: {
      type: String,
      default: ''
    },

    // -------------------- Payment Meta --------------------
    paymentId: {
      type: String,
      required: true
    },

    orderId: {
      type: String,
      required: true
    },

    status: {
      type: String,
      enum: ['active', 'pending', 'overdue', 'terminated'],
      default: 'active'
    },

    pendingDues: {
      type: Number,
      default: 0,
      min: 0
    },

    underNotice: {
      type: Boolean,
      default: false
    },

    // -------------------- Rent Tracking --------------------
    rentDueDate: {
      type: Date,
      default: null
    },

    lastRentPayment: {
      type: Date,
      default: null
    },

    rentPaymentHistory: [
      {
        amount: {
          type: Number,
          required: true,
          min: 0
        },

        monthsPaid: {
          type: Number,
          default: 1,
          min: 1
        },

        convenienceFee: {
          type: Number,
          default: 0,
          min: 0
        },

        paymentId: {
          type: String,
          required: true
        },

        orderId: {
          type: String,
          required: true
        },

        paidAt: {
          type: Date,
          default: Date.now
        }
      }
    ],

    // -------------------- Tenant Documents --------------------
    tenantDocuments: {
      type: Map,
      of: String,
      default: {}
    },

    documentsUploadedAt: {
      type: Date,
      default: null
    },

    // -------------------- Timestamps --------------------
    bookingDate: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,

    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        // ✅ FIX: Safe Map → Object conversion with null checks
        if (ret.tenantDocuments) {
          try {
            if (ret.tenantDocuments instanceof Map) {
              ret.tenantDocuments = Object.fromEntries(ret.tenantDocuments);
            } else if (typeof ret.tenantDocuments === 'object') {
              // Already an object, keep as is
              ret.tenantDocuments = ret.tenantDocuments;
            } else {
              ret.tenantDocuments = {};
            }
          } catch (err) {
            console.error('Error converting tenantDocuments:', err);
            ret.tenantDocuments = {};
          }
        } else {
          ret.tenantDocuments = {};
        }
        return ret;
      }
    },

    toObject: {
      virtuals: true,
      transform(doc, ret) {
        // ✅ FIX: Safe Map → Object conversion with null checks
        if (ret.tenantDocuments) {
          try {
            if (ret.tenantDocuments instanceof Map) {
              ret.tenantDocuments = Object.fromEntries(ret.tenantDocuments);
            } else if (typeof ret.tenantDocuments === 'object') {
              // Already an object, keep as is
              ret.tenantDocuments = ret.tenantDocuments;
            } else {
              ret.tenantDocuments = {};
            }
          } catch (err) {
            console.error('Error converting tenantDocuments:', err);
            ret.tenantDocuments = {};
          }
        } else {
          ret.tenantDocuments = {};
        }
        return ret;
      }
    }
  }
);

// =======================================================
// ✅ RENT PAYMENT METHODS
// =======================================================

bookingSchema.methods.recordRentPayment = async function (paymentData) {
  const {
    amount,
    monthsPaid = 1,
    convenienceFee = 0,
    paymentId,
    orderId
  } = paymentData;

  this.rentPaymentHistory.push({
    amount: Number(amount),
    monthsPaid: Number(monthsPaid),
    convenienceFee: Number(convenienceFee),
    paymentId,
    orderId,
    paidAt: new Date()
  });

  this.lastRentPayment = new Date();

  const baseDate = this.rentDueDate || new Date();
  const newDueDate = new Date(baseDate);
  newDueDate.setMonth(newDueDate.getMonth() + monthsPaid);

  this.rentDueDate = newDueDate;
  this.pendingDues = 0;
  this.status = 'active';

  await this.save();
  return this;
};

bookingSchema.methods.getPaymentStatus = function () {
  if (!this.rentDueDate) return 'pending_first_payment';

  const daysLeft = Math.ceil(
    (this.rentDueDate - new Date()) / (1000 * 60 * 60 * 24)
  );

  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 7) return 'due_soon';
  return 'active';
};

// =======================================================
// ✅ DOCUMENT METHODS
// =======================================================

bookingSchema.methods.updateDocuments = async function (documents) {
  this.tenantDocuments = new Map(Object.entries(documents));
  this.documentsUploadedAt = new Date();
  await this.save();
  return this;
};

bookingSchema.methods.addDocument = async function (key, url) {
  if (!this.tenantDocuments) this.tenantDocuments = new Map();
  this.tenantDocuments.set(key, url);
  this.documentsUploadedAt = new Date();
  await this.save();
  return this;
};

bookingSchema.methods.removeDocument = async function (key) {
  if (this.tenantDocuments) {
    this.tenantDocuments.delete(key);
    await this.save();
  }
  return this;
};

bookingSchema.methods.getDocuments = function () {
  if (!this.tenantDocuments) return {};
  
  try {
    if (this.tenantDocuments instanceof Map) {
      return Object.fromEntries(this.tenantDocuments);
    }
    return this.tenantDocuments;
  } catch (err) {
    console.error('Error getting documents:', err);
    return {};
  }
};

// =======================================================
// ✅ EXPORT MODEL
// =======================================================

module.exports =
  mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
