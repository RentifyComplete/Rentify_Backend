// ========================================
// PROPERTY ROUTES - CORRECTED VERSION
// File: routes/properties.js
// ✅ Fixed route ordering (admin routes first)
// ✅ Added simple GET endpoint for PDF fixing
// ========================================

const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const User = require('../models/user');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Multer configuration with validation
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
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

// ⭐⭐⭐ Helper function for PUBLIC PDF uploads ⭐⭐⭐
async function uploadPDFToCloudinary(filePath, filename) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rental_agreements',
      resource_type: 'raw',
      public_id: filename,
      type: 'upload',
      access_mode: 'public',    // ⭐ MAKES PDF PUBLIC
      overwrite: true,
    });
    
    console.log('✅ PDF uploaded as PUBLIC:', result.secure_url);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return result.secure_url;
  } catch (error) {
    console.error('❌ PDF upload failed:', error);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
}

// Helper function for Cloudinary image upload
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rentify_properties',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' },
      ],
    });
    fs.unlinkSync(filePath);
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw error;
  }
}

// ⭐⭐⭐ ADMIN ROUTES - MUST COME FIRST ⭐⭐⭐

// Simple GET route to fix all PDFs - Just visit in browser!
router.get('/fix-pdfs', async (req, res) => {
  try {
    console.log('🔧 Starting PDF access fix...');
    
    const properties = await Property.find({ 
      agreementUrl: { $exists: true, $ne: null } 
    });

    console.log(`📊 Found ${properties.length} properties with PDFs`);

    const results = [];

    for (const property of properties) {
      try {
        const urlParts = property.agreementUrl.split('/');
        const publicIdWithExt = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExt.replace('.pdf', '');

        await cloudinary.api.update(publicId, {
          resource_type: 'raw',
          type: 'upload',
          access_mode: 'public'
        });

        results.push({
          property: property.title,
          status: 'FIXED',
          url: property.agreementUrl
        });
        
        console.log(`✅ Fixed: ${property.title}`);
      } catch (err) {
        results.push({
          property: property.title,
          status: 'FAILED',
          error: err.message
        });
        console.error(`❌ Failed: ${property.title}`, err.message);
      }
    }

    const successCount = results.filter(r => r.status === 'FIXED').length;

    // Return nice HTML page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PDF Fix Results</title>
        <style>
          body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
          h1 { color: #2ecc71; }
          .box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin: 10px 0; }
          .fail { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>🎉 PDF Fix Complete!</h1>
        <div class="box">
          <h2>Results:</h2>
          <p><strong>✅ Success:</strong> ${successCount} PDFs</p>
          <p><strong>❌ Failed:</strong> ${results.length - successCount} PDFs</p>
        </div>
        
        ${results.map(r => `
          <div class="${r.status === 'FIXED' ? 'success' : 'fail'}">
            <strong>${r.status === 'FIXED' ? '✅' : '❌'} ${r.property}</strong><br>
            <small>${r.url || r.error}</small>
          </div>
        `).join('')}
        
        <div class="box" style="background: #fff3cd;">
          <h3>✅ What's Next?</h3>
          <ol>
            <li>PDFs are now publicly accessible</li>
            <li>Test your Flutter app - 401 errors should be GONE!</li>
            <li>All future uploads will be public automatically</li>
          </ol>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send(`<h1>Error: ${error.message}</h1>`);
  }
});

// Fix single property PDF
router.post('/fix-pdf/:propertyId', async (req, res) => {
  try {
    const property = await Property.findById(req.params.propertyId);
    
    if (!property || !property.agreementUrl) {
      return res.status(404).json({
        success: false,
        message: 'Property or agreement not found'
      });
    }

    const urlParts = property.agreementUrl.split('/');
    const publicIdWithExt = urlParts.slice(-2).join('/');
    const publicId = publicIdWithExt.replace('.pdf', '');

    await cloudinary.api.update(publicId, {
      resource_type: 'raw',
      type: 'upload',
      access_mode: 'public'
    });

    res.status(200).json({
      success: true,
      message: 'PDF is now public',
      url: property.agreementUrl
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ⭐⭐⭐ END ADMIN ROUTES ⭐⭐⭐

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

    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} images...`);
      for (const file of req.files) {
        try {
          const url = await uploadToCloudinary(file.path);
          imageUrls.push(url);
        } catch (uploadError) {
          console.error('Failed to upload image:', uploadError);
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

// ------------------- GET properties by owner -------------------
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

module.exports = router;
module.exports.uploadPDFToCloudinary = uploadPDFToCloudinary;