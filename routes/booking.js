const express = require('express');
const router = express.Router();

const Booking = require('../models/Booking');
const Property = require('../models/Property');

// =======================================================
// CREATE BOOKING  (POST /api/bookings)
// =======================================================
router.post('/', async (req, res) => {
  try {
    const {
      propertyId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      moveInDate,
      monthlyRent,
      securityDeposit,
      convenienceFee,
      totalAmount,
      leaseDuration,
      orderId,
      paymentId,
      notes
    } = req.body;

    if (!propertyId || !tenantEmail || !orderId || !paymentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required booking or payment fields'
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Prevent duplicate active booking
    const existing = await Booking.findOne({
      propertyId,
      tenantEmail,
      status: { $in: ['pending', 'active'] }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Active booking already exists for this property'
      });
    }

    // Dates
    const moveIn = moveInDate ? new Date(moveInDate) : new Date();
    const dueDate = new Date(moveIn);
    dueDate.setMonth(dueDate.getMonth() + Number(leaseDuration || 1));

    const booking = await Booking.create({
      propertyId,
      ownerId: property.ownerId,
      tenantId: tenantId || null,

      tenantName,
      tenantEmail,
      tenantPhone,

      propertyTitle: property.title,
      propertyAddress: property.address || property.location,

      // ✅ FIX: nullish coalescing (prevents 0 / 1 bugs)
      monthlyRent: Number(monthlyRent ?? property.price),
      securityDeposit: Number(securityDeposit ?? 0),
      convenienceFee: Number(convenienceFee ?? 0),
      totalAmount: Number(totalAmount),

      moveInDate: moveIn,
      leaseDuration: Number(leaseDuration),

      orderId,
      paymentId,
      notes: notes || '',

      rentDueDate: dueDate,
      lastRentPayment: new Date(),
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Booking create error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message
    });
  }
});


// =======================================================
// RECORD RENT PAYMENT
// POST /api/bookings/:id/rent
// =======================================================
router.post('/:id/rent', async (req, res) => {
  try {
    const { amount, monthsPaid, convenienceFee, paymentId, orderId } = req.body;

    if (!amount || !paymentId || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required rent payment fields'
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    await booking.recordRentPayment({
      amount,
      monthsPaid,
      convenienceFee,
      paymentId,
      orderId
    });

    res.json({
      success: true,
      message: 'Rent payment recorded successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Rent payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record rent payment',
      error: error.message
    });
  }
});


// =======================================================
// GET BOOKINGS FOR TENANT
// =======================================================
router.get('/tenant/:email', async (req, res) => {
  try {
    const bookings = await Booking.find({
      tenantEmail: req.params.email
    }).sort({ createdAt: -1 });

    res.json({ success: true, bookings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =======================================================
// GET BOOKINGS FOR OWNER
// =======================================================
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const bookings = await Booking.find({
      ownerId: req.params.ownerId
    }).sort({ createdAt: -1 });

    res.json({ success: true, bookings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =======================================================
// GET SINGLE BOOKING
// =======================================================
router.get('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    res.json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =======================================================
// UPDATE BOOKING (DOCUMENT SAFE)
// =======================================================
router.put('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // ✅ Document-safe update
    if (req.body.tenantDocuments) {
      await booking.updateDocuments(req.body.tenantDocuments);
    }

    Object.keys(req.body).forEach((key) => {
      if (key !== 'tenantDocuments') {
        booking[key] = req.body[key];
      }
    });

    booking.updatedAt = new Date();
    await booking.save();

    res.json({
      success: true,
      message: 'Booking updated successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Update booking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// =======================================================
// UPDATE STATUS
// =======================================================
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'active', 'completed', 'cancelled'];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({ success: false });
    }

    res.json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =======================================================
// DELETE SINGLE BOOKING
// =======================================================
router.delete('/:id', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false });
    }
    res.json({ success: true, message: 'Booking deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =======================================================
// CASCADE DELETE (PROPERTY)
// =======================================================
router.delete('/property/:propertyId', async (req, res) => {
  try {
    const result = await Booking.deleteMany({
      propertyId: req.params.propertyId
    });

    res.json({
      success: true,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
