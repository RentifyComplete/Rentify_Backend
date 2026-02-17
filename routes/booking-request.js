// routes/booking-request.js
// ⭐ Booking Request System - Tenant requests, Owner approves, then payment
// ⭐ UPDATED: Added signed agreement upload/fetch routes

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ⭐ Booking Request Schema
const bookingRequestSchema = new mongoose.Schema({
  propertyId: { type: String, required: true },
  ownerId: { type: String, required: true },
  tenantId: { type: String, default: null },
  tenantName: { type: String, required: true },
  tenantEmail: { type: String, required: true },
  tenantPhone: { type: String, required: true },

  // Property details (snapshot at time of request)
  propertyName: { type: String, required: true },
  propertyImage: { type: String, default: '' },
  propertyAddress: { type: String, default: '' },

  // Booking details
  monthlyRent: { type: Number, required: true },
  securityDeposit: { type: Number, required: true },
  moveInDate: { type: Date, required: true },
  leaseDuration: { type: Number, required: true },
  notes: { type: String, default: '' },
  occupancyType: { type: String, default: 'Single' },
  roomNumber: { type: String, default: null },

  // ⭐ Signed agreement (uploaded by tenant)
  signedAgreementUrl: { type: String, default: null },
  signedAgreementUploadedAt: { type: Date, default: null },

  // Request status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: { type: String, default: '' },

  // Timestamps
  requestDate: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const BookingRequest = mongoose.models.BookingRequest ||
  mongoose.model('BookingRequest', bookingRequestSchema);

// ============================================================
// CREATE BOOKING REQUEST (Tenant sends request to owner)
// ============================================================
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
      occupancyType,
    } = req.body;

    console.log('📝 Creating booking request for property:', propertyId);

    const Property = mongoose.model('Property');
    const property = await Property.findById(propertyId);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    const existingRequest = await BookingRequest.findOne({
      propertyId,
      tenantEmail,
      status: { $in: ['pending', 'approved'] }
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: existingRequest.status === 'approved'
          ? 'You already have an approved request for this property.'
          : 'You already have a pending request for this property.',
      });
    }

    const bookingRequest = new BookingRequest({
      propertyId,
      ownerId: property.ownerId,
      tenantId,
      tenantName,
      tenantEmail,
      tenantPhone,
      propertyName: property.title || 'Property',
      propertyImage: property.images?.[0] || property.image || '',
      propertyAddress: `${property.address || ''}, ${property.city || ''}, ${property.state || ''}`,
      monthlyRent,
      securityDeposit,
      moveInDate,
      leaseDuration,
      notes: notes || '',
      occupancyType: occupancyType || 'Single',
      status: 'pending',
    });

    await bookingRequest.save();
    console.log('✅ Booking request created:', bookingRequest._id);

    res.status(201).json({
      success: true,
      message: 'Booking request sent successfully! The owner will review your request.',
      requestId: bookingRequest._id,
      request: bookingRequest,
    });
  } catch (error) {
    console.error('❌ Error creating booking request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking request',
      error: error.message,
    });
  }
});

// ============================================================
// GET BOOKING REQUESTS FOR OWNER
// ============================================================
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    console.log('🔍 Fetching booking requests for owner:', ownerId);

    if (!ownerId || ownerId === 'undefined' || ownerId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Invalid owner ID',
        requests: [],
      });
    }

    const requests = await BookingRequest.find({ ownerId }).sort({ createdAt: -1 });
    console.log(`✅ Found ${requests.length} booking requests for owner`);

    const formattedRequests = requests.map(req => ({
      ...req.toObject(),
      requestDate: new Date(req.requestDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }),
      moveInDate: new Date(req.moveInDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }),
    }));

    res.status(200).json({
      success: true,
      requests: formattedRequests,
      bookingRequests: formattedRequests,
      count: formattedRequests.length,
    });
  } catch (error) {
    console.error('❌ Error fetching booking requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking requests',
      error: error.message,
      requests: [],
    });
  }
});

// ============================================================
// GET BOOKING REQUESTS FOR TENANT
// ============================================================
router.get('/tenant/:tenantEmail', async (req, res) => {
  try {
    const { tenantEmail } = req.params;
    console.log('🔍 Fetching booking requests for tenant:', tenantEmail);

    const requests = await BookingRequest.find({ tenantEmail }).sort({ createdAt: -1 });
    console.log(`✅ Found ${requests.length} booking requests for tenant`);

    const formattedRequests = requests.map(req => ({
      ...req.toObject(),
      requestDate: new Date(req.requestDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }),
      moveInDate: new Date(req.moveInDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }),
    }));

    res.status(200).json({
      success: true,
      requests: formattedRequests,
      count: formattedRequests.length,
    });
  } catch (error) {
    console.error('❌ Error fetching tenant requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests',
      error: error.message,
      requests: [],
    });
  }
});

// ============================================================
// APPROVE BOOKING REQUEST (Owner approves)
// ============================================================
router.put('/:requestId/approve', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { roomNumber } = req.body;
    console.log('✅ Approving booking request:', requestId);

    const request = await BookingRequest.findByIdAndUpdate(
      requestId,
      {
        status: 'approved',
        roomNumber: roomNumber,
        respondedAt: new Date(),
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Booking request not found' });
    }

    console.log('✅ Booking request approved successfully');
    res.status(200).json({
      success: true,
      message: 'Booking request approved! Tenant can now proceed with payment.',
      request: request,
    });
  } catch (error) {
    console.error('❌ Error approving booking request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve booking request',
      error: error.message,
    });
  }
});

// ============================================================
// REJECT BOOKING REQUEST (Owner rejects)
// ============================================================
router.put('/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    console.log('❌ Rejecting booking request:', requestId);

    const request = await BookingRequest.findByIdAndUpdate(
      requestId,
      {
        status: 'rejected',
        rejectionReason: reason || 'No reason provided',
        respondedAt: new Date(),
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Booking request not found' });
    }

    console.log('✅ Booking request rejected successfully');
    res.status(200).json({
      success: true,
      message: 'Booking request rejected',
      request: request,
    });
  } catch (error) {
    console.error('❌ Error rejecting booking request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject booking request',
      error: error.message,
      requests: [],
    });
  }
});

// ============================================================
// DELETE BOOKING REQUEST (Tenant cancels)
// ============================================================
router.delete('/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    console.log('🗑️ Deleting booking request:', requestId);

    const request = await BookingRequest.findByIdAndDelete(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Booking request not found' });
    }

    console.log('✅ Booking request deleted successfully');
    res.status(200).json({
      success: true,
      message: 'Booking request cancelled successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting booking request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete booking request',
      error: error.message,
    });
  }
});

// ============================================================
// ⭐ UPLOAD SIGNED AGREEMENT (Tenant uploads signed PDF)
// ============================================================
router.put('/:bookingId/signed-agreement', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { signedAgreementUrl } = req.body;

    console.log('📄 Saving signed agreement for booking:', bookingId);
    console.log('   URL:', signedAgreementUrl);

    if (!signedAgreementUrl) {
      return res.status(400).json({
        success: false,
        message: 'signedAgreementUrl is required',
      });
    }

    const updated = await BookingRequest.findByIdAndUpdate(
      bookingId,
      {
        signedAgreementUrl: signedAgreementUrl,
        signedAgreementUploadedAt: new Date(),
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    console.log('✅ Signed agreement URL saved successfully');
    res.status(200).json({
      success: true,
      message: 'Signed agreement uploaded successfully',
      signedAgreementUrl: signedAgreementUrl,
    });
  } catch (error) {
    console.error('❌ Error saving signed agreement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save signed agreement',
      error: error.message,
    });
  }
});

// ============================================================
// ⭐ GET SIGNED AGREEMENT (Owner fetches tenant's signed PDF)
// ============================================================
router.get('/:bookingId/signed-agreement', async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await BookingRequest.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    res.status(200).json({
      success: true,
      signedAgreementUrl: booking.signedAgreementUrl || null,
      uploadedAt: booking.signedAgreementUploadedAt || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch signed agreement',
      error: error.message,
    });
  }
});

module.exports = router;
