// models/Booking.js
// ⭐ FIXED: Booking Model with proper payment history tracking
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  propertyId: { type: String, required: true },
  ownerId: { type: String, required: true },
  tenantId: { type: String, default: null },
  tenantName: { type: String, required: true },
  tenantEmail: { type: String, required: true },
  tenantPhone: { type: String, required: true },
  
  // ⭐ Store property details for easy retrieval
  propertyTitle: { type: String, default: '' },
  propertyAddress: { type: String, default: '' },
  
  monthlyRent: { type: Number, required: true },
  securityDeposit: { type: Number, required: true },
  convenienceFee: { type: Number, default: 0 },
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
  rentDueDate: { type: Date, default: null },
  lastRentPayment: { type: Date, default: null },
  rentPaymentHistory: [{
    amount: { type: Number, required: true },
    monthsPaid: { type: Number, default: 1 },
    convenienceFee: { type: Number, default: 0 },
    paymentId: { type: String, required: true },
    orderId: { type: String, required: true },
    paidAt: { type: Date, default: Date.now }
  }],
  
  bookingDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ⭐ FIXED: Method to record rent payment and extend due date
bookingSchema.methods.recordRentPayment = async function(paymentData) {
  const { amount, monthsPaid, convenienceFee, paymentId, orderId } = paymentData;
  
  console.log('💾 Recording rent payment:', {
    bookingId: this._id,
    amount,
    monthsPaid,
    convenienceFee,
    paymentId
  });
  
  // Add to payment history
  this.rentPaymentHistory.push({
    amount: Number(amount),
    monthsPaid: Number(monthsPaid || 1),
    convenienceFee: Number(convenienceFee || 0),
    paymentId: paymentId,
    orderId: orderId,
    paidAt: new Date()
  });
  
  // Update last payment date
  this.lastRentPayment = new Date();
  
  // Calculate new due date
  const currentDueDate = this.rentDueDate || new Date();
  const newDueDate = new Date(currentDueDate);
  newDueDate.setMonth(newDueDate.getMonth() + Number(monthsPaid || 1));
  this.rentDueDate = newDueDate;
  
  // Update status
  this.status = 'active';
  this.pendingDues = 0;
  this.updatedAt = new Date();
  
  await this.save();
  
  console.log('✅ Rent payment recorded:', {
    monthsPaid,
    newDueDate,
    totalPayments: this.rentPaymentHistory.length
  });
  
  return this;
};

// ⭐ Method to get payment status
bookingSchema.methods.getPaymentStatus = function() {
  if (!this.rentDueDate) return 'pending_first_payment';
  
  const now = new Date();
  const daysUntilDue = Math.ceil((this.rentDueDate - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= 7) return 'due_soon';
  return 'active';
};

// Export with check to prevent OverwriteModelError
module.exports = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
