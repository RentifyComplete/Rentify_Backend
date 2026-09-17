// utils/paymentReminderCron.js
const cron = require('node-cron');
const Booking = require('../models/Booking'); // ⚠️ confirm this path/name
const Notification = require('../models/Notification');

const REMINDER_DAYS_BEFORE = 7;

async function runPaymentReminderCheck() {
  console.log('🔔 Checking for upcoming rent due dates...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + REMINDER_DAYS_BEFORE);

  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  let created = 0;
  let skipped = 0;

  const bookings = await Booking.find({
    status: 'active',
    nextDueDate: { $gte: targetDate, $lt: nextDay },
  }).populate('tenantId propertyId');

  console.log(`📋 Found ${bookings.length} booking(s) due in ${REMINDER_DAYS_BEFORE} days`);

  for (const booking of bookings) {
    const dueDateStr = booking.nextDueDate.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    try {
      await Notification.create({
        tenantId: booking.tenantId._id,
        bookingId: booking._id,
        title: 'Rent Payment Due Soon',
        message: `Your rent of ₹${booking.monthlyRent} for ${booking.propertyId?.title || 'your property'} is due on ${dueDateStr}. Please make the payment on time to avoid late fees.`,
        category: 'Payment',
        priority: 'High',
        dueDate: booking.nextDueDate,
      });
      created++;
    } catch (err) {
      if (err.code === 11000) {
        skipped++; // reminder already exists for this due date
      } else {
        console.error(`❌ Failed to create reminder for booking ${booking._id}:`, err.message);
      }
    }
  }

  console.log(`✅ Payment reminders: ${created} created, ${skipped} already existed`);
  return { created, skipped, checked: bookings.length };
}

function startPaymentReminderCron() {
  // Runs daily at 9:00 AM IST
  cron.schedule('0 9 * * *', runPaymentReminderCheck, {
    timezone: 'Asia/Kolkata',
  });
  console.log('⏰ Payment reminder cron job scheduled (daily 9 AM IST)');
}

module.exports = { startPaymentReminderCron, runPaymentReminderCheck };
