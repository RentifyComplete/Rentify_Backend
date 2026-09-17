// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  tenantEmail: { type: String, required: true, lowercase: true, trim: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  category: { type: String, default: 'Payment' },
  priority: { type: String, default: 'High' },
  dueDate: { type: Date, required: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// One reminder per booking per due date — prevents duplicate spam if the cron runs twice
notificationSchema.index({ bookingId: 1, dueDate: 1 }, { unique: true });

module.exports = mongoose.model('Notification', notificationSchema);
