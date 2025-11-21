// ========================================
// FINAL SERVER.JS - WITH SUBSCRIPTION CRON JOB
// ✅ Includes property status checking
// ✅ Auto-suspend overdue properties
// ========================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

// ⭐ NEW: Import property status cron job
const { startPropertyStatusCron, runPropertyStatusCheck } = require('./utils/propertyStatusCron');

const app = express();
const PORT = process.env.PORT || 3001;

// ------------------- Middleware -------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------- Request Logger (DEBUG) -------------------
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

// ------------------- MongoDB Connection -------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    
    // ⭐ NEW: Start property status cron job after DB connection
    console.log('🕒 Starting property status monitoring...');
    startPropertyStatusCron();
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ------------------- Health Check Route -------------------
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Rentify API is running',
    timestamp: new Date().toISOString(),
    features: [
      'Property Management',
      'User Authentication',
      'Payment Processing',
      'Booking System',
      'Monthly Subscription (Auto-renewal)',
      'Property Status Monitoring (Cron Job)'
    ],
    routes: [
      'GET /',
      'GET /api/properties',
      'POST /api/properties',
      'POST /api/auth/*',
      'POST /api/payments/*',
      'POST /api/bookings/*',
      'GET /api/payments/service-status/:propertyId',
      'GET /api/payments/owner-service-status/:ownerId',
      'GET /api/admin/check-property-status (Manual trigger)'
    ]
  });
});

// ------------------- Routes -------------------
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const paymentRoutes = require('./routes/payment');
app.use('/api/payments', paymentRoutes);

const propertyRoutes = require('./routes/propertyRoutes');
app.use('/api/properties', propertyRoutes);

const bookingRoutes = require('./routes/booking');
app.use('/api/bookings', bookingRoutes);

// ⭐ NEW: Admin endpoint to manually trigger property status check
app.get('/api/admin/check-property-status', async (req, res) => {
  try {
    console.log('🔧 Manual property status check triggered...');
    const result = await runPropertyStatusCheck();
    res.json({
      success: true,
      message: 'Property status check completed',
      ...result
    });
  } catch (error) {
    console.error('❌ Manual check failed:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to run property status check',
      error: error.message 
    });
  }
});

// ------------------- 404 Handler -------------------
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.url}`
  });
});

// ------------------- Error Handler -------------------
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

// ------------------- Create Uploads Directory -------------------
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
  console.log('📁 Created uploads directory');
}

// ⭐ NEW: Create utils directory if it doesn't exist
if (!fs.existsSync('utils')) {
  fs.mkdirSync('utils');
  console.log('📁 Created utils directory');
}

// ------------------- Start Server -------------------
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('🚀 RENTIFY API SERVER');
  console.log('========================================');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🗄️  MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Connecting... ⏳'}`);
  console.log(`🕒 Cron Job: Active (Daily at 2:00 AM) ✅`);
  console.log('========================================');
  console.log('\n✨ Features Active:');
  console.log('  - Property Management');
  console.log('  - Payment Processing (Razorpay)');
  console.log('  - Booking System');
  console.log('  - Monthly Subscription');
  console.log('  - Auto-suspend Overdue Properties');
  console.log('\n📋 Manual Trigger:');
  console.log(`  GET http://localhost:${PORT}/api/admin/check-property-status`);
  console.log('========================================\n');
});

// ⭐ NEW: Graceful shutdown
// NEW (CORRECT):
process.on('SIGTERM', async () => {
  console.log('⚠️  SIGTERM received. Shutting down gracefully...');
  try {
    await mongoose.connection.close(); // ✅ No callback, use await
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('⚠️  SIGINT received. Shutting down gracefully...');
  try {
    await mongoose.connection.close(); // ✅ No callback, use await
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});
