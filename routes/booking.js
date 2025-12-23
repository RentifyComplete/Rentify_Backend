const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const Property = require('../models/Property');
const User = require('../models/user'); // ✅ FIXED: Uppercase 'U' to match filename

// =======================================================
// HELPER: Find tenant by email and return ObjectId
// =======================================================
async function getTenantIdByEmail(email) {
  try {
    if (!email) return null;
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user && user._id) {
      return user._id;
    }
    return null;
  } catch (error) {
    console.error('Error finding tenant by email:', error);
    return null;
  }
}

// =======================================================
// CREATE BOOKING
// =======================================================
const createBookingHandler = async (req, res) => {
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

    console.log('📥 Create booking request:', {
      propertyId,
      tenantId,
      tenantEmail,
      tenantName
    });

    // ✅ Validate required fields
    if (!propertyId || !tenantEmail || !orderId || !paymentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required booking or payment fields'
      });
    }

    // ✅ Verify property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // ✅ Check for duplicate active booking
    const existing = await Booking.findOne({
      propertyId,
      tenantEmail: tenantEmail.toLowerCase(),
      status: { $in: ['pending', 'active'] }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Active booking already exists for this property'
      });
    }

    // ✅ Resolve tenantId from email if not provided
    let properTenantId = null;
    if (tenantId && mongoose.Types.ObjectId.isValid(tenantId)) {
      properTenantId = tenantId;
    } else if (tenantEmail) {
      properTenantId = await getTenantIdByEmail(tenantEmail);
    }

    console.log('✅ Resolved tenantId:', properTenantId);

    // ✅ Calculate dates
    const moveIn = moveInDate ? new Date(moveInDate) : new Date();
    const dueDate = new Date(moveIn);
    dueDate.setMonth(dueDate.getMonth() + Number(leaseDuration || 1));

    // ✅ Create booking
    const booking = await Booking.create({
      propertyId,
      ownerId: property.ownerId,
      tenantId: properTenantId, // ✅ Now properly handles null

      tenantName,
      tenantEmail: tenantEmail.toLowerCase(),
      tenantPhone,

      propertyTitle: property.title,
      propertyAddress: property.address || property.location,

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
      status: 'active',
      
      // ✅ Initialize empty documents Map
      tenantDocuments: new Map()
    });

    console.log('✅ Booking created:', booking._id);

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
};

router.post('/', createBookingHandler);
router.post('/create', createBookingHandler);

// =======================================================
// UPDATE BOOKING - WITH MAP DOCUMENT HANDLING
// =======================================================
const updateBookingHandler = async (req, res) => {
  try {
    console.log('📥 Update booking request:', {
      bookingId: req.params.id,
      body: req.body
    });

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // ✅ Handle tenant documents separately (Map type)
    if (req.body.tenantDocuments) {
      console.log('📄 Updating documents:', req.body.tenantDocuments);
      
      try {
        // Use the model's updateDocuments method for safe Map handling
        await booking.updateDocuments(req.body.tenantDocuments);
        console.log('✅ Documents updated successfully');
      } catch (docError) {
        console.error('❌ Error updating documents:', docError);
        return res.status(500).json({
          success: false,
          message: 'Failed to update documents',
          error: docError.message
        });
      }
    }

    // ✅ Update other fields (exclude protected fields)
    const protectedFields = [
      'tenantDocuments', // Already handled above
      '_id',
      'tenantId',        // Never update from request
      'ownerId',         // Never update from request
      'propertyId',      // Never update from request
      'createdAt'        // Mongoose handles this
    ];

    Object.keys(req.body).forEach((key) => {
      if (!protectedFields.includes(key)) {
        booking[key] = req.body[key];
      }
    });

    booking.updatedAt = new Date();
    await booking.save();

    console.log('✅ Booking updated successfully:', booking._id);

    res.json({
      success: true,
      message: 'Booking updated successfully',
      booking
    });

  } catch (error) {
    console.error('❌ Update booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking',
      error: error.message
    });
  }
};

router.put('/:id', updateBookingHandler);
router.patch('/:id', updateBookingHandler);
router.post('/:id', updateBookingHandler);

// =======================================================
// RECORD RENT PAYMENT
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
      tenantEmail: req.params.email.toLowerCase()
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
// UPDATE STATUS
// =======================================================
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'active', 'overdue', 'terminated'];

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