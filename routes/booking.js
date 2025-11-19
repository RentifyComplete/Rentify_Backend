// Backend: routes/booking.js
// Add this new file to your backend

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

// ========================================
// CREATE BOOKING (After successful payment)
// ========================================
router.post('/create', async (req, res) => {
  try {
    const {
      propertyId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      monthlyRent,
      securityDeposit,
      moveInDate,
      leaseDuration,
      notes,
      paymentId,
      orderId,
    } = req.body;

    console.log('📝 Creating booking:', { propertyId, tenantEmail });

    // Get database
    const db = req.app.locals.db;
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected',
      });
    }

    // Get property to find owner
    const property = await db.collection('properties').findOne({
      _id: new ObjectId(propertyId),
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Create booking document
    const booking = {
      propertyId: new ObjectId(propertyId),
      ownerId: new ObjectId(property.ownerId),
      tenantId: tenantId ? new ObjectId(tenantId) : null,
      tenantName,
      tenantEmail,
      tenantPhone,
      monthlyRent,
      securityDeposit,
      totalAmount: monthlyRent + securityDeposit,
      moveInDate,
      leaseDuration,
      notes: notes || '',
      paymentId,
      orderId,
      status: 'active', // active, pending, cancelled, completed
      pendingDues: 0,
      underNotice: false,
      bookingDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('bookings').insertOne(booking);

    console.log('✅ Booking created:', result.insertedId);

    res.status(200).json({
      success: true,
      message: 'Booking created successfully',
      bookingId: result.insertedId,
      booking: {
        ...booking,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error('❌ Error creating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message,
    });
  }
});

// ========================================
// GET BOOKINGS FOR OWNER
// ========================================
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;

    console.log('🔍 Fetching bookings for owner:', ownerId);

    const db = req.app.locals.db;
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected',
        bookings: [] // ⭐ Add this
      });
    }

    const bookings = await db
      .collection('bookings')
      .find({ ownerId: new ObjectId(ownerId) })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`✅ Found ${bookings.length} bookings`);

    res.status(200).json({
      success: true,
      bookings: bookings || [], // ⭐ Ensure it's always an array, never null
    });
  } catch (error) {
    console.error('❌ Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message,
      bookings: [] // ⭐ Add this even for errors
    });
  }
});
// ========================================
// GET BOOKINGS FOR TENANT
// ========================================
router.get('/tenant/:tenantEmail', async (req, res) => {
  try {
    const { tenantEmail } = req.params;

    console.log('🔍 Fetching bookings for tenant:', tenantEmail);

    const db = req.app.locals.db;
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected',
      });
    }

    const bookings = await db
      .collection('bookings')
      .find({ tenantEmail: tenantEmail })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`✅ Found ${bookings.length} bookings for tenant`);

    res.status(200).json({
      success: true,
      bookings,
    });
  } catch (error) {
    console.error('❌ Error fetching tenant bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message,
    });
  }
});

// ========================================
// UPDATE BOOKING STATUS
// ========================================
router.put('/:bookingId/status', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, underNotice, pendingDues } = req.body;

    const db = req.app.locals.db;
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected',
      });
    }

    const updateData = {
      updatedAt: new Date(),
    };

    if (status) updateData.status = status;
    if (underNotice !== undefined) updateData.underNotice = underNotice;
    if (pendingDues !== undefined) updateData.pendingDues = pendingDues;

    const result = await db.collection('bookings').updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: updateData }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking updated successfully',
    });
  } catch (error) {
    console.error('❌ Error updating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking',
      error: error.message,
    });
  }
});

module.exports = router;
