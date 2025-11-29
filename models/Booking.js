// models/Booking.js
// ⭐ Booking Model with 2.7% convenience fee tracking and rent payment history

const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  propertyId: { type: String, required: true },
  ownerId: { type: String, required: true },
  tenantId: { type: String, default: null },
  tenantName: { type: String, required: true },
  tenantEmail: { type: String, required: true },
  tenantPhone: { type: String, required: true },
  monthlyRent: { type: Number, required: true },
  securityDeposit: { type: Number, required: true },
  convenienceFee: { type: Number, default: 0 }, // ⭐ 2.7% convenience fee
  totalAmount: { type: Number, required: true },
  moveInDate: { type: Date, required: true },
  leaseDuration: { type: Number, required: true },
  notes: { type: String, default: '' },
  paymentId: { type: String, required: true },
  orderId: { type: String, required: true },
  status: { type: String, default: 'active' },
  pendingDues: { type: Number, default: 0 },
  underNotice: { type: Boolean, default: false },
  
  // ⭐ Rent payment tracking
  rentDueDate: { type: Date, default: null }, // Next rent due date
  lastRentPayment: { type: Date, default: null }, // Last rent payment date
  rentPaymentHistory: [{
    amount: Number,
    monthsPaid: Number,
    convenienceFee: Number,
    paymentId: String,
    orderId: String,
    paidAt: { type: Date, default: Date.now }
  }],
  
  bookingDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ⭐ Method to record rent payment and extend due date
bookingSchema.methods.recordRentPayment = async function(paymentData) {
  const { amount, monthsPaid, convenienceFee, paymentId, orderId } = paymentData;
  
  // Add to payment history
  this.rentPaymentHistory.push({
    amount,
    monthsPaid,
    convenienceFee,
    paymentId,
    orderId,
    paidAt: new Date()
  });
  
  // Update last payment date
  this.lastRentPayment = new Date();
  
  // Calculate new due date
  const currentDueDate = this.rentDueDate || new Date();
  const newDueDate = new Date(currentDueDate);
  newDueDate.setMonth(newDueDate.getMonth() + monthsPaid);
  this.rentDueDate = newDueDate;
  
  // Update status
  this.status = 'active';
  this.pendingDues = 0;
  this.updatedAt = new Date();
  
  await this.save();
  
  console.log(`✅ Rent payment recorded: ${monthsPaid} month(s) paid, new due date: ${newDueDate}`);
};

// Export with check to prevent OverwriteModelError
module.exports = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
