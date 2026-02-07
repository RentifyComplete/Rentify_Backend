// ========================================
// PROPERTY ROUTES - CORRECTED VERSION
// File: routes/propertyRoutes.js
// ✅ Fixed PDF upload with correct resource_type and access_mode
// ✅ Fixed route ordering (admin routes first)
// ✅ Proper error handling
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

// ⭐⭐⭐ CORRECTED Helper function for PUBLIC PDF uploads ⭐⭐⭐
async function uploadPDFToCloudinary(filePath, filename) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rental_agreements',
      resource_type: 'raw',        // ✅ CRITICAL: Use 'raw' for PDFs (not 'image')
      public_id: filename,
      type: 'upload',
      access_mode: 'public',        // ✅ CRITICAL: Makes PDF publicly accessible
      overwrite: true,
    });
    
    console.log('✅ PDF uploaded as PUBLIC:', result.secure_url);
    console.log('   Resource Type:', result.resource_type);
    console.log('   Format:', result.format);
    
    // Clean up temporary file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // ✅ URL will be: https://res.cloudinary.com/.../raw/upload/.../file.pdf
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

// ✅ IMPROVED: Fix all PDFs with better error handling
router.get('/fix-pdfs', async (req, res) => {
  try {
    console.log('🔧 Starting PDF access fix...');
    
    const properties = await Property.find({ 
      agreementUrl: { $exists: true, $ne: null } 
    });

    console.log(`📊 Found ${properties.length} properties with PDFs`);

    const results = [];
    let successCount = 0;

    for (const property of properties) {
      try {
        const agreementUrl = property.agreementUrl;
        
        if (!agreementUrl || typeof agreementUrl !== 'string') {
          results.push({
            property: property.title || 'Unknown',
            status: 'SKIPPED',
            error: 'Invalid agreement URL'
          });
          continue;
        }

        // Extract public_id from URL
        // URL format: https://res.cloudinary.com/{cloud}/raw/upload/v{version}/{folder}/{file}.pdf
        // OR: https://res.cloudinary.com/{cloud}/image/upload/v{version}/{folder}/{file}.pdf (old wrong format)
        const urlParts = agreementUrl.split('/');
        const lastPart = urlParts[urlParts.length - 1]; // file.pdf
        const folder = urlParts[urlParts.length - 2];   // rental_agreements
        
        const publicIdWithExt = `${folder}/${lastPart}`;
        const publicId = publicIdWithExt.replace('.pdf', '');

        console.log(`🔄 Fixing: ${property.title}`);
        console.log(`   URL: ${agreementUrl}`);
        console.log(`   Public ID: ${publicId}`);

        // Update access mode to public
        await cloudinary.api.update(publicId, {
          resource_type: 'raw',
          type: 'upload',
          access_mode: 'public'
        });

        results.push({
          property: property.title || 'Unknown',
          status: 'FIXED',
          url: agreementUrl
        });
        
        successCount++;
        console.log(`✅ Fixed: ${property.title}`);
        
      } catch (err) {
        results.push({
          property: property.title || 'Unknown',
          status: 'FAILED',
          error: err.message
        });
        console.error(`❌ Failed: ${property.title}`, err.message);
      }
    }

    // Return nice HTML page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PDF Fix Results</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            max-width: 900px; 
            margin: 50px auto; 
            padding: 20px;
            background: #f5f5f5;
          }
          h1 { 
            color: #2ecc71;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .box { 
            background: white;
            padding: 20px; 
            border-radius: 12px;
            margin: 20px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .success { 
            background: #d4edda;
            color: #155724;
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            border-left: 4px solid #28a745;
          }
          .fail { 
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            border-left: 4px solid #dc3545;
          }
          .skip {
            background: #fff3cd;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            border-left: 4px solid #ffc107;
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
          }
          .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .stat-number {
            font-size: 36px;
            font-weight: bold;
            margin: 10px 0;
          }
          .stat-label {
            color: #666;
            font-size: 14px;
          }
          .next-steps {
            background: #e7f3ff;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #2196f3;
          }
          .url-test {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            word-break: break-all;
            font-size: 12px;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <h1>
          <span style="font-size: 48px;">🎉</span>
          PDF Fix Complete!
        </h1>
        
        <div class="stats">
          <div class="stat-card">
            <div class="stat-number" style="color: #28a745;">${successCount}</div>
            <div class="stat-label">Successfully Fixed</div>
          </div>
          <div class="stat-card">
            <div class="stat-number" style="color: #dc3545;">${results.filter(r => r.status === 'FAILED').length}</div>
            <div class="stat-label">Failed</div>
          </div>
          <div class="stat-card">
            <div class="stat-number" style="color: #ffc107;">${results.filter(r => r.status === 'SKIPPED').length}</div>
            <div class="stat-label">Skipped</div>
          </div>
        </div>
        
        <div class="box">
          <h2>📋 Detailed Results:</h2>
          ${results.map(r => `
            <div class="${r.status === 'FIXED' ? 'success' : r.status === 'FAILED' ? 'fail' : 'skip'}">
              <strong>${r.status === 'FIXED' ? '✅' : r.status === 'FAILED' ? '❌' : '⚠️'} ${r.property}</strong><br>
              ${r.url ? `
                <div class="url-test">
                  <a href="${r.url}" target="_blank" style="color: #007bff;">🔗 Test PDF: ${r.url}</a>
                </div>
              ` : ''}
              ${r.error ? `<small style="color: #dc3545;">Error: ${r.error}</small>` : ''}
            </div>
          `).join('')}
        </div>
        
        <div class="next-steps">
          <h3>✅ What's Next?</h3>
          <ol>
            <li><strong>Test the PDFs:</strong> Click on the "Test PDF" links above - they should open directly in your browser</li>
            <li><strong>Test your Flutter app:</strong> The 401 errors should now be GONE!</li>
            <li><strong>Future uploads:</strong> All new PDFs will be public automatically</li>
          </ol>
          
          ${successCount > 0 ? `
            <p style="margin-top: 20px; padding: 15px; background: #d4edda; border-radius: 8px;">
              <strong>🎊 Great news!</strong> ${successCount} PDF${successCount > 1 ? 's are' : ' is'} now publicly accessible!
            </p>
          ` : ''}
          
          ${results.filter(r => r.status === 'FAILED').length > 0 ? `
            <p style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 8px;">
              <strong>⚠️ Note:</strong> Failed PDFs may need to be regenerated. 
              Use the "Regenerate Agreement" button in your Flutter app for those properties.
            </p>
          ` : ''}
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { 
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
          }
          .error {
            background: #f8d7da;
            color: #721c24;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #dc3545;
          }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Error</h1>
          <p>${error.message}</p>
        </div>
      </body>
      </html>
    `);
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

    const agreementUrl = property.agreementUrl;
    const urlParts = agreementUrl.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];
    
    const publicIdWithExt = `${folder}/${lastPart}`;
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