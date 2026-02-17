// ========================================
// PROPERTY ROUTES - SUPABASE STORAGE
// File: routes/propertyRoutes.js
// ✅ Replaced Cloudinary with Supabase
// ✅ PDFs open directly in browser
// ✅ No more 401 errors
// ✅ Simple public URLs
// ========================================

const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const User = require('../models/user');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // ✅ NEW: For Supabase uploads

// ✅ Supabase configuration (replaces Cloudinary)
const SUPABASE_URL = 'https://sysgayeogkjjulqkzaee.supabase.co';
const SUPABASE_KEY = 'sb_secret_s6gB8PeTTpGXC1qPDfIpQA_mCJxKzAv';
const SUPABASE_BUCKET = 'rentify-files';

// Multer configuration
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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

// ========================================
// UPLOAD PDF TO SUPABASE
// ========================================
async function uploadPDFToSupabase(filePath, filename) {
  try {
    console.log('📤 Uploading PDF to Supabase...');
    console.log('   File path:', filePath);
    console.log('   Filename:', filename);

    // Read file
    const fileBuffer = fs.readFileSync(filePath);
    console.log('   File size:', fileBuffer.length, 'bytes');

    // Upload path in bucket
    const uploadPath = `rental_agreements/${filename}`;

    // Upload to Supabase Storage
    const response = await axios.post(
      `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${uploadPath}`,
      fileBuffer,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    if (response.status === 200 || response.status === 201) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${uploadPath}`;

      console.log('✅ PDF uploaded successfully to Supabase!');
      console.log('   URL:', publicUrl);
      console.log('   🎉 This URL opens directly in browser!');

      // Clean up temp file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('🗑️ Temporary file deleted');
      }

      return publicUrl;
    } else {
      throw new Error(`Upload failed with status ${response.status}`);
    }

  } catch (error) {
    console.error('❌ Supabase PDF upload failed:', error.message);

    // Clean up on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw error;
  }
}

// ========================================
// UPLOAD IMAGE TO SUPABASE
// ========================================
async function uploadImageToSupabase(filePath, folder = 'property_images') {
  try {
    console.log('📸 Uploading image to Supabase...');

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const uploadPath = `${folder}/${filename}`;

    // Detect content type
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    const contentType = mimeTypes[ext] || 'image/jpeg';

    const response = await axios.post(
      `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${uploadPath}`,
      fileBuffer,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    if (response.status === 200 || response.status === 201) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${uploadPath}`;

      console.log('✅ Image uploaded:', publicUrl);

      // Clean up
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      return publicUrl;
    } else {
      throw new Error(`Upload failed with status ${response.status}`);
    }

  } catch (error) {
    console.error('❌ Supabase image upload failed:', error.message);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw error;
  }
}

// ========================================
// ADMIN ROUTES - FIX PDFs (kept for reference)
// ========================================
router.get('/fix-pdfs', async (req, res) => {
  try {
    const properties = await Property.find({
      agreementUrl: { $exists: true, $ne: null }
    });

    res.json({
      success: true,
      message: `Found ${properties.length} properties with agreements. Cloudinary fix not needed - using Supabase now!`,
      properties: properties.map(p => ({
        title: p.title,
        agreementUrl: p.agreementUrl
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// GET all properties
// ========================================
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

// ========================================
// GET single property by ID
// ========================================
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

// ========================================
// POST create new property
// ========================================
router.post('/', upload.array('images', 10), async (req, res) => {
  try {
    const {
      title,
      location,
      price,
      type,
      bhk,
      beds,
      rooms,
      amenities,
      description,
      address,
      city,
      state,
      zipCode,
      ownerId,
      ownerName,
      signatureUrl,
      agreementUrl,
    } = req.body;

    console.log('📝 Creating new property...');

    if (!title || !location || !price || !type || !description || !ownerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // ✅ Upload images to Supabase
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} images to Supabase...`);
      for (const file of req.files) {
        try {
          const url = await uploadImageToSupabase(file.path);
          imageUrls.push(url);
        } catch (uploadError) {
          console.error('Failed to upload image:', uploadError);
          // Clean up failed file
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
      }
    }

    const property = new Property({
      title,
      location,
      price,
      type,
      bhk,
      beds: beds ? parseInt(beds) : undefined,
      rooms: rooms ? parseInt(rooms) : undefined,
      amenities: typeof amenities === 'string' ? JSON.parse(amenities) : amenities,
      description,
      address,
      city,
      state,
      zipCode,
      ownerId,
      images: imageUrls,
      ownerName,
      signatureUrl,
      agreementUrl,
    });

    if (agreementUrl) {
      property.agreementGeneratedAt = new Date();
    }

    const now = new Date();
    property.serviceDueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    property.serviceStatus = 'active';
    property.lastServicePayment = now;
    property.monthlyServiceCharge = property.calculateServiceCharge();

    try {
      const owner = await User.findById(ownerId);
      if (owner && owner.tempPropertyPayment) {
        const tempPayment = owner.tempPropertyPayment;

        if (new Date() < tempPayment.expiresAt) {
          property.servicePaymentHistory = [{
            amount: tempPayment.amount,
            monthsPaid: 1,
            paymentId: tempPayment.paymentId,
            orderId: tempPayment.orderId,
            status: 'completed',
            paidAt: tempPayment.paidAt,
          }];

          await User.findByIdAndUpdate(ownerId, {
            $unset: { tempPropertyPayment: 1 }
          });
        }
      }
    } catch (linkError) {
      console.error('⚠️ Error linking payment:', linkError.message);
    }

    const savedProperty = await property.save();

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: savedProperty,
    });
  } catch (error) {
    console.error('❌ Error creating property:', error);

    // Clean up any remaining temp files
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

// ========================================
// PUT update property
// ========================================
router.put('/:id', upload.array('images', 10), async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    const {
      title,
      location,
      price,
      type,
      bhk,
      beds,
      rooms,
      amenities,
      description,
      address,
      city,
      state,
      zipCode,
      agreementUrl,
      ownerName,
      signatureUrl,
    } = req.body;

    if (title) property.title = title;
    if (location) property.location = location;
    if (price) property.price = price;
    if (type) property.type = type;
    if (bhk) property.bhk = bhk;
    if (beds) property.beds = parseInt(beds);
    if (rooms) property.rooms = parseInt(rooms);
    if (amenities) property.amenities = typeof amenities === 'string' ? JSON.parse(amenities) : amenities;
    if (description) property.description = description;
    if (address) property.address = address;
    if (city) property.city = city;
    if (state) property.state = state;
    if (zipCode) property.zipCode = zipCode;

    if (agreementUrl !== undefined) {
      property.agreementUrl = agreementUrl;
      property.agreementGeneratedAt = new Date();
    }
    if (ownerName !== undefined) property.ownerName = ownerName;
    if (signatureUrl !== undefined) property.signatureUrl = signatureUrl;

    if (type || bhk || beds || rooms) {
      property.monthlyServiceCharge = property.calculateServiceCharge();
    }

    // ✅ Upload new images to Supabase
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} new images to Supabase...`);
      const newImageUrls = [];
      for (const file of req.files) {
        try {
          const url = await uploadImageToSupabase(file.path);
          newImageUrls.push(url);
        } catch (uploadError) {
          console.error('Failed to upload image:', uploadError);
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
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

// ========================================
// DELETE property
// ========================================
router.delete('/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    property.isActive = false;
    property.serviceStatus = 'suspended';
    property.suspendedAt = new Date();
    property.suspensionReason = 'Deleted by owner';
    await property.save();

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

// ========================================
// GET properties by owner
// ========================================
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const properties = await Property.find({
      ownerId: req.params.ownerId,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: properties.length,
      data: properties,
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

// ========================================
// SERVICE CHARGE ROUTES
// ========================================
router.post('/:id/service-payment', async (req, res) => {
  try {
    const { amount, monthsPaid, paymentId, orderId } = req.body;

    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    await property.recordPayment({ amount, monthsPaid, paymentId, orderId });

    res.json({ success: true, message: 'Payment recorded', data: property });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id/service-status', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const status = property.getPaymentStatus();
    res.json({
      success: true,
      status,
      serviceDueDate: property.serviceDueDate,
      monthlyServiceCharge: property.monthlyServiceCharge,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.uploadPDFToSupabase = uploadPDFToSupabase;
