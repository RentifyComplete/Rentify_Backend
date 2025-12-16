// routes/booking.js
// Complete booking routes with CASCADE DELETE endpoint + /create endpoint

const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Property = require('../models/Property');
const User = require('../models/user');

// ============================================================================
// CREATE BOOKING (Primary endpoint - POST /)
// ============================================================================
router.post('/', async (req, res) => {
  try {
    const {
      propertyId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      moveInDate,
      rentAmount,
      securityDeposit,
      status = 'pending'
    } = req.body;

    console.log('📋 Creating new booking...');
    console.log('Property ID:', propertyId);
    console.log('Tenant ID:', tenantId);
    console.log('Tenant Email:', tenantEmail);

    // Validate required fields
    if (!propertyId || !tenantId || !tenantEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: propertyId, tenantId, tenantEmail'
      });
    }

    // Check if property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if tenant already has a booking for this property
    const existingBooking = await Booking.findOne({
      propertyId,
      tenantId,
      status: { $in: ['pending', 'active'] }
    });

    if (existingBooking) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active booking for this property'
      });
    }

    // Create new booking
    const newBooking = new Booking({
      propertyId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      moveInDate,
      monthlyRent: rentAmount || property.price,
      securityDeposit,
      status,
      propertyTitle: property.title,
      propertyAddress: property.address || property.location,
      propertyLocation: property.location,
      propertyType: property.type,
      ownerId: property.ownerId
    });

    await newBooking.save();

    console.log('✅ Booking created successfully:', newBooking._id);

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: newBooking
    });

  } catch (error) {
    console.error('❌ Error creating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message
    });
  }
});

// ============================================================================
// ⭐ CREATE BOOKING (Alternative endpoint - POST /create)
// For apps that call /api/bookings/create
// ============================================================================
router.post('/create', async (req, res) => {
  try {
    const {
      propertyId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      moveInDate,
      monthlyRent,
      rentAmount,
      securityDeposit,
      status = 'pending'
    } = req.body;

    console.log('📋 Creating new booking (via /create endpoint)...');
    console.log('Property ID:', propertyId);
    console.log('Tenant Email:', tenantEmail);

    // Validate required fields
    if (!propertyId || !tenantEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: propertyId, tenantEmail'
      });
    }

    // Check if property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if tenant already has an active booking for this property
    const existingBooking = await Booking.findOne({
      propertyId,
      tenantEmail,
      status: { $in: ['pending', 'active'] }
    });

    if (existingBooking) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active booking for this property'
      });
    }

    // Use rentAmount or monthlyRent, fallback to property price
    const finalRentAmount = rentAmount || monthlyRent || property.price;

    // Create new booking
    const newBooking = new Booking({
      propertyId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      moveInDate,
      monthlyRent: finalRentAmount,
      securityDeposit: securityDeposit || 0,
      status,
      propertyTitle: property.title,
      propertyAddress: property.address || property.location,
      propertyLocation: property.location,
      propertyType: property.type,
      ownerId: property.ownerId
    });

    await newBooking.save();

    console.log('✅ Booking created successfully:', newBooking._id);

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: newBooking
    });

  } catch (error) {
    console.error('❌ Error creating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message
    });
  }
});

// ============================================================================
// GET ALL BOOKINGS FOR A TENANT (by email)
// ============================================================================
router.get('/tenant/:email', async (req, res) => {
  try {
    const { email } = req.params;

    console.log('📋 Fetching bookings for tenant email:', email);

    // Try both tenantId and tenantEmail fields
    const bookings = await Booking.find({
      $or: [
        { tenantId: email },
        { tenantEmail: email }
      ]
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings for tenant`);

    res.status(200).json({
      success: true,
      bookings
    });

  } catch (error) {
    console.error('❌ Error fetching tenant bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message
    });
  }
});

// ============================================================================
// GET ALL BOOKINGS FOR AN OWNER
// ============================================================================
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;

    console.log('📋 Fetching bookings for owner:', ownerId);

    // Find all bookings where ownerId matches
    const bookings = await Booking.find({ ownerId }).sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings for owner`);

    res.status(200).json({
      success: true,
      bookings
    });

  } catch (error) {
    console.error('❌ Error fetching owner bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message
    });
  }
});

// ============================================================================
// GET SINGLE BOOKING BY ID
// ============================================================================
router.get('/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;

    console.log('📋 Fetching booking:', bookingId);

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('✅ Booking found');

    res.status(200).json({
      success: true,
      booking
    });

  } catch (error) {
    console.error('❌ Error fetching booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking',
      error: error.message
    });
  }
});

// ============================================================================
// UPDATE BOOKING STATUS
// ============================================================================
router.put('/:bookingId/status', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;

    console.log('📋 Updating booking status:', bookingId);
    console.log('New status:', status);

    const validStatuses = ['pending', 'active', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: pending, active, completed, cancelled'
      });
    }

    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('✅ Booking status updated');

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Error updating booking status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status',
      error: error.message
    });
  }
});

// ============================================================================
// UPDATE BOOKING DETAILS
// ============================================================================
router.put('/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const updates = req.body;

    console.log('📋 Updating booking:', bookingId);

    // Add updatedAt timestamp
    updates.updatedAt = new Date();

    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      updates,
      { new: true, runValidators: true }
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('✅ Booking updated successfully');

    res.status(200).json({
      success: true,
      message: 'Booking updated successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Error updating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking',
      error: error.message
    });
  }
});

// ============================================================================
// DELETE SINGLE BOOKING
// ============================================================================
router.delete('/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;

    console.log('🗑️ Deleting booking:', bookingId);

    const booking = await Booking.findByIdAndDelete(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('✅ Booking deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Booking deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete booking',
      error: error.message
    });
  }
});

// ============================================================================
// ⭐ CASCADE DELETE - DELETE ALL BOOKINGS FOR A PROPERTY
// This is called when an owner deletes a property
// ============================================================================
router.delete('/property/:propertyId', async (req, res) => {
  try {
    const { propertyId } = req.params;

    console.log('🗑️ ==================== DELETE PROPERTY BOOKINGS ====================');
    console.log('Property ID:', propertyId);

    // Find all bookings for this property (for logging)
    const bookingsToDelete = await Booking.find({ propertyId });
    
    console.log(`📋 Found ${bookingsToDelete.length} booking(s) to delete`);

    if (bookingsToDelete.length > 0) {
      console.log('📋 Bookings to be deleted:');
      bookingsToDelete.forEach((booking, index) => {
        console.log(`  ${index + 1}. Booking ID: ${booking._id}`);
        console.log(`     Tenant: ${booking.tenantEmail}`);
        console.log(`     Status: ${booking.status}`);
        console.log(`     Property: ${booking.propertyTitle}`);
      });
    }

    // Delete all bookings for this property
    const result = await Booking.deleteMany({ propertyId });

    console.log(`✅ Successfully deleted ${result.deletedCount} booking(s)`);
    console.log('🗑️ ==================== DELETE SUCCESS ====================\n');

    res.status(200).json({
      success: true,
      message: `${result.deletedCount} booking(s) deleted successfully`,
      deletedCount: result.deletedCount,
    });

  } catch (error) {
    console.error('❌ Error deleting bookings for property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bookings',
      error: error.message,
    });
  }
});

// ============================================================================
// GET BOOKINGS BY STATUS
// ============================================================================
router.get('/status/:status', async (req, res) => {
  try {
    const { status } = req.params;

    console.log('📋 Fetching bookings with status:', status);

    const bookings = await Booking.find({ status }).sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings with status: ${status}`);

    res.status(200).json({
      success: true,
      bookings
    });

  } catch (error) {
    console.error('❌ Error fetching bookings by status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message
    });
  }
});

// ============================================================================
// GET ACTIVE BOOKINGS FOR A PROPERTY
// ============================================================================
router.get('/property/:propertyId/active', async (req, res) => {
  try {
    const { propertyId } = req.params;

    console.log('📋 Fetching active bookings for property:', propertyId);

    const bookings = await Booking.find({
      propertyId,
      status: 'active'
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} active bookings`);

    res.status(200).json({
      success: true,
      bookings
    });

  } catch (error) {
    console.error('❌ Error fetching active bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active bookings',
      error: error.message
    });
  }
});

// ============================================================================
// GET BOOKING STATISTICS FOR OWNER
// ============================================================================
router.get('/owner/:ownerId/stats', async (req, res) => {
  try {
    const { ownerId } = req.params;

    console.log('📊 Fetching booking statistics for owner:', ownerId);

    const [totalBookings, activeBookings, pendingBookings, completedBookings, cancelledBookings] = await Promise.all([
      Booking.countDocuments({ ownerId }),
      Booking.countDocuments({ ownerId, status: 'active' }),
      Booking.countDocuments({ ownerId, status: 'pending' }),
      Booking.countDocuments({ ownerId, status: 'completed' }),
      Booking.countDocuments({ ownerId, status: 'cancelled' })
    ]);

    const stats = {
      totalBookings,
      activeBookings,
      pendingBookings,
      completedBookings,
      cancelledBookings
    };

    console.log('✅ Statistics calculated:', stats);

    res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Error fetching booking statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking statistics',
      error: error.message
    });
  }
});

// ============================================================================
// CANCEL BOOKING (TENANT)
// ============================================================================
router.post('/:bookingId/cancel', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    console.log('🚫 Cancelling booking:', bookingId);
    console.log('Reason:', reason);

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Booking is already cancelled'
      });
    }

    booking.status = 'cancelled';
    booking.cancellationReason = reason;
    booking.cancelledAt = new Date();
    booking.updatedAt = new Date();

    await booking.save();

    console.log('✅ Booking cancelled successfully');

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking',
      error: error.message
    });
  }
});

// ============================================================================
// ACCEPT BOOKING (OWNER)
// ============================================================================
router.post('/:bookingId/accept', async (req, res) => {
  try {
    const { bookingId } = req.params;

    console.log('✅ Accepting booking:', bookingId);

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending bookings can be accepted'
      });
    }

    booking.status = 'active';
    booking.acceptedAt = new Date();
    booking.updatedAt = new Date();

    await booking.save();

    console.log('✅ Booking accepted successfully');

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Error accepting booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept booking',
      error: error.message
    });
  }
});

// ============================================================================
// REJECT BOOKING (OWNER)
// ============================================================================
router.post('/:bookingId/reject', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    console.log('❌ Rejecting booking:', bookingId);
    console.log('Reason:', reason);

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending bookings can be rejected'
      });
    }

    booking.status = 'cancelled';
    booking.rejectionReason = reason;
    booking.rejectedAt = new Date();
    booking.updatedAt = new Date();

    await booking.save();

    console.log('✅ Booking rejected successfully');

    res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Error rejecting booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject booking',
      error: error.message
    });
  }
});

module.exports = router;
