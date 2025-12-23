// scripts/migrate-booking-tenantid.js
// One-time migration to fix existing bookings with email in tenantId field
// Run this ONCE before deploying new code

const mongoose = require('mongoose');
require('dotenv').config();

async function migrateBookingTenantIds() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const bookingsCollection = db.collection('bookings');
    const usersCollection = db.collection('users');

    // Find all bookings where tenantId is a string (email)
    console.log('🔍 Searching for bookings with email in tenantId...');
    const brokenBookings = await bookingsCollection.find({
      tenantId: { $type: 'string' }
    }).toArray();

    console.log(`📊 Found ${brokenBookings.length} bookings to fix`);

    if (brokenBookings.length === 0) {
      console.log('✅ No bookings need fixing!');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Show what will be fixed
    console.log('\n📋 Bookings to fix:');
    for (let i = 0; i < brokenBookings.length; i++) {
      const booking = brokenBookings[i];
      console.log(`${i + 1}. Booking ID: ${booking._id}`);
      console.log(`   Tenant Email: ${booking.tenantEmail}`);
      console.log(`   Current tenantId: "${booking.tenantId}" (invalid)`);
    }

    console.log('\n🔧 Starting migration...\n');
    let fixedCount = 0;

    for (const booking of brokenBookings) {
      try {
        // Try to find the actual user by email
        const user = await usersCollection.findOne({ 
          email: booking.tenantEmail.toLowerCase()
        });

        let newTenantId = null;
        if (user && user._id) {
          newTenantId = user._id;
          console.log(`✅ Booking ${booking._id}: Found user account, setting tenantId to ${newTenantId}`);
        } else {
          console.log(`ℹ️  Booking ${booking._id}: No user account found, setting tenantId to null`);
        }

        // Update the booking
        await bookingsCollection.updateOne(
          { _id: booking._id },
          { $set: { tenantId: newTenantId } }
        );

        fixedCount++;
        console.log(`   ✓ Fixed (${fixedCount}/${brokenBookings.length})`);
      } catch (error) {
        console.error(`❌ Error fixing booking ${booking._id}:`, error.message);
      }
    }

    // Verify the fix
    console.log('\n🔍 Verifying migration...');
    const remainingBroken = await bookingsCollection.find({
      tenantId: { $type: 'string' }
    }).toArray();

    if (remainingBroken.length === 0) {
      console.log('✅ All bookings successfully migrated!');
      console.log(`📊 Summary: Fixed ${fixedCount} out of ${brokenBookings.length} bookings`);
    } else {
      console.log(`⚠️  ${remainingBroken.length} bookings still have issues`);
      remainingBroken.forEach(b => {
        console.log(`   - Booking ${b._id}: tenantId = "${b.tenantId}"`);
      });
    }

    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    console.log('✅ Migration complete!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the migration
console.log('========================================');
console.log('📦 BOOKING TENANTID MIGRATION');
console.log('========================================\n');
migrateBookingTenantIds();