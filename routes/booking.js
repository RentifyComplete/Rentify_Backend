// routes/booking.js
// ⭐ UPDATED: Now includes 2.7% convenience fee tracking

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Booking Schema
const bookingSchema = new mongoose.Schema({
  propertyId: { type: String, required: true },
  ownerId: { type: String, required: true },
  tenantId: { type: String, default: null },
  tenantName: { type: String, required: true },
  tenantEmail: { type: String, required: true },
  tenantPhone: { type: String, required: true },
  monthlyRent: { type: Number, required: true },
  securityDeposit: { type: Number, required: true },
  convenienceFee: { type: Number, default: 0 }, // ⭐ NEW: 2.7% convenience fee
  totalAmount: { type: Number, required: true },
  moveInDate: { type: Date, required: true },
  leaseDuration: { type: Number, required: true },
  notes: { type: String, default: '' },
  paymentId: { type: String, required: true },
  orderId: { type: String, required: true },
  status: { type: String, default: 'active' },
  pendingDues: { type: Number, default: 0 },
  underNotice: { type: Boolean, default: false },
  bookingDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Booking = mongoose.model('Booking', bookingSchema);

// CREATE BOOKING
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

    // Get property to find owner
    const Property = mongoose.model('Property');
    const property = await Property.findById(propertyId);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // ⭐ Calculate convenience fee (2.7%)
    const baseAmount = monthlyRent + securityDeposit;
    const convenienceFee = Math.round((baseAmount * 2.7) / 100);
    const totalAmount = baseAmount + convenienceFee;

    console.log('💰 Payment breakdown:');
    console.log('   Monthly Rent: ₹' + monthlyRent);
    console.log('   Security Deposit: ₹' + securityDeposit);
    console.log('   Convenience Fee (2.7%): ₹' + convenienceFee);
    console.log('   Total: ₹' + totalAmount);

    // Create booking
    const booking = new Booking({
      propertyId,
      ownerId: property.ownerId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      monthlyRent,
      securityDeposit,
      convenienceFee, // ⭐ Store convenience fee
      totalAmount,
      moveInDate,
      leaseDuration,
      notes: notes || '',
      paymentId,
      orderId,
      status: 'active',
      pendingDues: 0,
      underNotice: false,
    });

    await booking.save();

    console.log('✅ Booking created:', booking._id);

    res.status(200).json({
      success: true,
      message: 'Booking created successfully',
      bookingId: booking._id,
      booking: booking,
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

// GET BOOKINGS FOR OWNER
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;

    console.log('🔍 Fetching bookings for owner:', ownerId);

    if (!ownerId || ownerId === 'undefined' || ownerId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Invalid owner ID',
        bookings: [],
      });
    }

    const bookings = await Booking.find({ ownerId: ownerId })
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings for owner ${ownerId}`);

    res.status(200).json({
      success: true,
      bookings: bookings,
      count: bookings.length,
    });
  } catch (error) {
    console.error('❌ Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message,
      bookings: [],
    });
  }
});

// GET BOOKINGS FOR TENANT
router.get('/tenant/:tenantEmail', async (req, res) => {
  try {
    const { tenantEmail } = req.params;

    console.log('🔍 Fetching bookings for tenant:', tenantEmail);

    const bookings = await Booking.find({ tenantEmail: tenantEmail })
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings for tenant`);

    res.status(200).json({
      success: true,
      bookings: bookings,
    });
  } catch (error) {
    console.error('❌ Error fetching tenant bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message,
      bookings: [],
    });
  }
});

// UPDATE BOOKING STATUS
router.put('/:bookingId/status', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, underNotice, pendingDues } = req.body;

    const updateData = { updatedAt: Date.now() };

    if (status) updateData.status = status;
    if (underNotice !== undefined) updateData.underNotice = underNotice;
    if (pendingDues !== undefined) updateData.pendingDues = pendingDues;

    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      updateData,
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking updated successfully',
      booking: booking,
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
