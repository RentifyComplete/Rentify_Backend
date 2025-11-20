// ========================================
// FINAL PROPERTY ROUTES - WITH SERVICE CHARGE SETUP
// ✅ Sets serviceDueDate on property creation
// ✅ Calculates initial service charge
// ✅ Includes all existing functionality
// ========================================

const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer configuration with validation
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed (jpeg, jpg, png, webp)'));
  },
});

// Helper function for Cloudinary upload
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rentify_properties',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' },
      ],
    });
    fs.unlinkSync(filePath); // Delete local file after upload
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw error;
  }
}

// ------------------- GET all properties -------------------
router.get('/', async (req, res) => {
  try {
    const {
      city,
      type,
      minPrice,
      maxPrice,
      bhk,
      page = 1,
      limit = 20,
    } = req.query;

    // Build filter object - only show active properties
    const filter = { isActive: true };

    if (city) filter.city = new RegExp(city, 'i');
    if (type) filter.type = type;
    if (bhk) filter.bhk = bhk;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = minPrice;
      if (maxPrice) filter.price.$lte = maxPrice;
    }

    const skip = (page - 1) * limit;

    const properties = await Property.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Property.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: properties.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: properties,
    });
  } catch (error) {
    console.error('❌ Error fetching properties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch properties',
      error: error.message,
    });
  }
});

// ------------------- GET single property by ID -------------------
router.get('/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    res.status(200).json({
      success: true,
      data: property,
    });
  } catch (error) {
    console.error('❌ Error fetching property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch property',
      error: error.message,
    });
  }
});

// ------------------- POST create new property -------------------
router.post('/', upload.array('images', 10), async (req, res) => {
  try {
    const {
      title,
      location,
      price,
      type,
      bhk,
      beds,
      amenities,
      description,
      address,
      city,
      state,
      zipCode,
      ownerId,
    } = req.body;

    console.log('📝 Creating new property...');
    console.log('  Title:', title);
    console.log('  Type:', type);
    console.log('  Owner ID:', ownerId);

    // Validate required fields
    if (!title || !location || !price || !type || !description || !ownerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, location, price, type, description, ownerId',
      });
    }

    // Upload images to Cloudinary
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} images...`);
      for (const file of req.files) {
        try {
          const url = await uploadToCloudinary(file.path);
          imageUrls.push(url);
        } catch (uploadError) {
          console.error('Failed to upload image:', uploadError);
          // Continue with other images even if one fails
        }
      }
      console.log(`✅ Uploaded ${imageUrls.length} images`);
    }

    // Create property
    const property = new Property({
      title,
      location,
      price,
      type,
      bhk,
      beds: beds ? parseInt(beds) : undefined,
      amenities: typeof amenities === 'string' ? JSON.parse(amenities) : amenities,
      description,
      address,
      city,
      state,
      zipCode,
      ownerId,
      images: imageUrls,
    });

    // ⭐ NEW: Set up service charge subscription
    // First payment already done, so give 30 days free
    const now = new Date();
    property.serviceDueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    property.serviceStatus = 'active';
    property.lastServicePayment = now;
    property.monthlyServiceCharge = property.calculateServiceCharge();

    console.log('💰 Service charge setup:');
    console.log('  Monthly charge: ₹' + property.monthlyServiceCharge);
    console.log('  Due date: ' + property.serviceDueDate.toISOString());
    console.log('  Status: ' + property.serviceStatus);

    const savedProperty = await property.save();

    console.log('✅ Property created successfully with ID:', savedProperty._id);

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: savedProperty,
      serviceInfo: {
        monthlyCharge: savedProperty.monthlyServiceCharge,
        nextDueDate: savedProperty.serviceDueDate,
        status: savedProperty.serviceStatus,
        message: 'Your property is active for 30 days. Next payment due on ' + 
                 savedProperty.serviceDueDate.toLocaleDateString()
      }
    });
  } catch (error) {
    console.error('❌ Error creating property:', error);

    // Cleanup uploaded files on error
    if (req.files) {
      req.files.forEach((file) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create property',
      error: error.message,
    });
  }
});

// ------------------- PUT update property -------------------
router.put('/:id', upload.array('images', 10), async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Update fields
    const {
      title,
      location,
      price,
      type,
      bhk,
      beds,
      amenities,
      description,
      address,
      city,
      state,
      zipCode,
    } = req.body;

    if (title) property.title = title;
    if (location) property.location = location;
    if (price) property.price = price;
    if (type) property.type = type;
    if (bhk) property.bhk = bhk;
    if (beds) property.beds = parseInt(beds);
    if (amenities) property.amenities = typeof amenities === 'string' ? JSON.parse(amenities) : amenities;
    if (description) property.description = description;
    if (address) property.address = address;
    if (city) property.city = city;
    if (state) property.state = state;
    if (zipCode) property.zipCode = zipCode;

    // ⭐ NEW: Recalculate service charge if type/beds/bhk changed
    if (type || bhk || beds) {
      const oldCharge = property.monthlyServiceCharge;
      property.monthlyServiceCharge = property.calculateServiceCharge();
      
      if (oldCharge !== property.monthlyServiceCharge) {
        console.log(`💰 Service charge updated: ₹${oldCharge} → ₹${property.monthlyServiceCharge}`);
      }
    }

    // Upload new images if provided
    if (req.files && req.files.length > 0) {
      const newImageUrls = [];
      for (const file of req.files) {
        try {
          const url = await uploadToCloudinary(file.path);
          newImageUrls.push(url);
        } catch (uploadError) {
          console.error('Failed to upload image:', uploadError);
        }
      }
      property.images = [...property.images, ...newImageUrls];
    }

    const updatedProperty = await property.save();

    res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: updatedProperty,
    });
  } catch (error) {
    console.error('❌ Error updating property:', error);

    // Cleanup uploaded files on error
    if (req.files) {
      req.files.forEach((file) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update property',
      error: error.message,
    });
  }
});

// ------------------- DELETE property -------------------
router.delete('/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Soft delete (set isActive to false) instead of hard delete
    property.isActive = false;
    property.serviceStatus = 'suspended';
    property.suspendedAt = new Date();
    property.suspensionReason = 'Deleted by owner';
    await property.save();

    console.log(`🗑️  Property soft-deleted: ${property._id}`);

    // Or use hard delete:
    // await Property.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Property deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete property',
      error: error.message,
    });
  }
});

// ------------------- GET properties by owner -------------------
router.get('/owner/:ownerId', async (req, res) => {
  try {
    console.log('🔍 Fetching properties for owner:', req.params.ownerId);
    
    // ⭐ UPDATED: Return ALL properties (including suspended) so owner can see payment status
    const properties = await Property.find({
      ownerId: req.params.ownerId,
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${properties.length} properties`);

    res.status(200).json({
      success: true,
      count: properties.length,
      properties: properties, // ⭐ Changed from 'data' to 'properties' for consistency
    });
  } catch (error) {
    console.error('❌ Error fetching owner properties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch properties',
      error: error.message,
    });
  }
});

// ⭐ NEW: GET property service status
router.get('/:id/service-status', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    const now = new Date();
    const daysUntilDue = Math.ceil((property.serviceDueDate - now) / (1000 * 60 * 60 * 24));
    const status = property.getPaymentStatus();

    res.json({
      success: true,
      data: {
        propertyId: property._id,
        propertyTitle: property.title,
        serviceStatus: status,
        isActive: property.isActive,
        serviceDueDate: property.serviceDueDate,
        daysUntilDue: daysUntilDue,
        isOverdue: daysUntilDue < 0,
        inGracePeriod: daysUntilDue < 0 && daysUntilDue >= -10,
        gracePeriodDaysLeft: daysUntilDue < 0 ? Math.max(0, 10 + daysUntilDue) : null,
        monthlyCharge: property.calculateServiceCharge(),
        lastPayment: property.lastServicePayment,
        paymentHistory: property.servicePaymentHistory.slice(-5).reverse(),
      }
    });
  } catch (error) {
    console.error('❌ Error fetching service status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service status',
      error: error.message,
    });
  }
});

module.exports = router;