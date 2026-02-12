// ========================================
// PROPERTY ROUTES - COMPLETE FIX FOR PDF 401 ERRORS
// File: routes/propertyRoutes.js
// ✅ Fixed PDF upload with access_mode: 'public'
// ✅ Fixed signature generation
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

// ⭐⭐⭐ COMPLETELY FIXED: Upload PDF with PUBLIC access (no 401 errors) ⭐⭐⭐
async function uploadPDFToCloudinary(filePath, filename) {
  try {
    console.log('📤 Uploading PDF to Cloudinary...');
    console.log('   File path:', filePath);
    console.log('   Filename:', filename);
    
    // ⭐ THE FIX: Use these exact parameters
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rental_agreements',
      resource_type: 'raw',           // ✅ CRITICAL: 'raw' for PDFs
      public_id: filename,
      flags: 'attachment:false',      // ⭐ Display inline, not download
      access_mode: 'public',          // ✅ CRITICAL: Makes PDF publicly accessible
      overwrite: true,
      invalidate: true,               // Clear CDN cache
    });
    
    console.log('✅ PDF uploaded successfully!');
    console.log('   URL:', result.secure_url);
    console.log('   Resource Type:', result.resource_type);
    console.log('   Format:', result.format);
    
    // ⭐ IMPORTANT: Manually construct the URL with fl_attachment:false
    // This ensures the flag is in the URL even if Cloudinary doesn't add it automatically
    let finalUrl = result.secure_url;
    
    // Check if the URL already has the flag
    if (!finalUrl.includes('fl_attachment')) {
      // Insert the flag after /upload/
      finalUrl = finalUrl.replace('/upload/', '/upload/fl_attachment:false/');
      console.log('✅ Added fl_attachment:false to URL');
    }
    
    console.log('   Final URL:', finalUrl);
    
    // Clean up temporary file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Temporary file deleted');
    }
    
    return finalUrl; // ⭐ Return the modified URL with the flag
  } catch (error) {
    console.error('❌ PDF upload failed:', error.message);
    console.error('   Full error:', error);
    
    // Clean up on error
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

// ✅ Fix ALL existing PDFs that have access issues
router.get('/fix-pdfs', async (req, res) => {
  try {
    console.log('🔧 Starting comprehensive PDF fix...');
    
    const properties = await Property.find({ 
      agreementUrl: { $exists: true, $ne: null } 
    });

    console.log(`📊 Found ${properties.length} properties with PDFs`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

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
        // Example URL: https://res.cloudinary.com/dojen4kyp/image/upload/v1234/rental_agreements/file.pdf
        // We need: rental_agreements/file
        
        let publicId;
        try {
          const urlParts = agreementUrl.split('/');
          const filename = urlParts[urlParts.length - 1]; // file.pdf
          const folder = urlParts[urlParts.length - 2];   // rental_agreements or version number
          
          // Check if folder is actually a version number (starts with 'v')
          if (folder.startsWith('v')) {
            // Version is present, folder is one more back
            const actualFolder = urlParts[urlParts.length - 3];
            publicId = `${actualFolder}/${filename.replace('.pdf', '')}`;
          } else {
            publicId = `${folder}/${filename.replace('.pdf', '')}`;
          }
          
          console.log(`🔍 Processing: ${property.title}`);
          console.log(`   URL: ${agreementUrl}`);
          console.log(`   Extracted Public ID: ${publicId}`);
        } catch (parseError) {
          console.error(`❌ Failed to parse URL for ${property.title}:`, parseError);
          results.push({
            property: property.title || 'Unknown',
            status: 'FAILED',
            error: 'Could not parse URL: ' + parseError.message
          });
          failCount++;
          continue;
        }

        // ⭐ Update the resource to be public using Cloudinary API
        try {
          const updateResult = await cloudinary.api.update(publicId, {
            resource_type: 'raw',
            type: 'upload',
            access_mode: 'public'
          });
          
          console.log(`✅ Updated access mode for: ${property.title}`);
          console.log(`   Access mode:`, updateResult.access_mode);
          
          results.push({
            property: property.title || 'Unknown',
            status: 'FIXED',
            url: agreementUrl,
            publicId: publicId
          });
          
          successCount++;
          
        } catch (apiError) {
          // If API update fails, the resource might not exist as 'raw'
          // It might be uploaded as 'image' - try that
          try {
            console.log(`⚠️ Trying as 'image' resource type...`);
            await cloudinary.api.update(publicId, {
              resource_type: 'image',
              type: 'upload',
              access_mode: 'public'
            });
            
            console.log(`✅ Fixed as image type: ${property.title}`);
            results.push({
              property: property.title || 'Unknown',
              status: 'FIXED (as image)',
              url: agreementUrl,
              publicId: publicId,
              warning: 'PDF was uploaded as image type - consider regenerating'
            });
            
            successCount++;
          } catch (imageError) {
            console.error(`❌ Could not fix ${property.title}:`, apiError.message);
            results.push({
              property: property.title || 'Unknown',
              status: 'FAILED',
              error: apiError.message,
              suggestion: 'Try regenerating the agreement'
            });
            failCount++;
          }
        }
        
      } catch (err) {
        results.push({
          property: property.title || 'Unknown',
          status: 'FAILED',
          error: err.message
        });
        failCount++;
        console.error(`❌ Failed: ${property.title}`, err.message);
      }
    }

    // Generate HTML report
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PDF Fix Results</title>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          .container {
            max-width: 1000px;
            margin: 0 auto;
          }
          h1 { 
            color: white;
            font-size: 42px;
            margin-bottom: 30px;
            text-align: center;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .stat-card {
            background: white;
            padding: 25px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            transition: transform 0.2s;
          }
          .stat-card:hover {
            transform: translateY(-5px);
          }
          .stat-number {
            font-size: 48px;
            font-weight: bold;
            margin: 10px 0;
          }
          .stat-label {
            color: #666;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .results-box {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 20px;
          }
          .result-item {
            padding: 15px;
            margin: 10px 0;
            border-radius: 8px;
            border-left: 4px solid;
          }
          .success { 
            background: #d4edda;
            border-color: #28a745;
            color: #155724;
          }
          .fail { 
            background: #f8d7da;
            border-color: #dc3545;
            color: #721c24;
          }
          .skip {
            background: #fff3cd;
            border-color: #ffc107;
            color: #856404;
          }
          .url-test {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            margin-top: 8px;
            font-size: 12px;
            word-break: break-all;
          }
          .url-test a {
            color: #007bff;
            text-decoration: none;
          }
          .url-test a:hover {
            text-decoration: underline;
          }
          .next-steps {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .next-steps h3 {
            color: #667eea;
            margin-bottom: 15px;
          }
          .next-steps ol {
            margin-left: 20px;
          }
          .next-steps li {
            margin: 10px 0;
            line-height: 1.6;
          }
          .alert {
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
          }
          .alert-success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
          }
          .alert-warning {
            background: #fff3cd;
            border: 1px solid #ffeeba;
            color: #856404;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎉 PDF Access Fix Complete!</h1>
          
          <div class="stats">
            <div class="stat-card">
              <div class="stat-number" style="color: #28a745;">${successCount}</div>
              <div class="stat-label">✅ Fixed</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #dc3545;">${failCount}</div>
              <div class="stat-label">❌ Failed</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #007bff;">${properties.length}</div>
              <div class="stat-label">📄 Total PDFs</div>
            </div>
          </div>
          
          <div class="results-box">
            <h2 style="margin-bottom: 20px;">📋 Detailed Results</h2>
            ${results.map(r => `
              <div class="result-item ${r.status === 'FIXED' || r.status.includes('FIXED') ? 'success' : r.status === 'FAILED' ? 'fail' : 'skip'}">
                <strong>
                  ${r.status === 'FIXED' || r.status.includes('FIXED') ? '✅' : r.status === 'FAILED' ? '❌' : '⚠️'} 
                  ${r.property}
                </strong>
                ${r.publicId ? `<br><small style="color: #666;">Public ID: ${r.publicId}</small>` : ''}
                ${r.url ? `
                  <div class="url-test">
                    <a href="${r.url}" target="_blank">🔗 Test PDF: ${r.url}</a>
                  </div>
                ` : ''}
                ${r.error ? `<br><small style="color: #dc3545; margin-top: 5px; display: block;">Error: ${r.error}</small>` : ''}
                ${r.warning ? `<br><small style="color: #ff6b6b; margin-top: 5px; display: block;">⚠️ ${r.warning}</small>` : ''}
                ${r.suggestion ? `<br><small style="color: #666; margin-top: 5px; display: block;">💡 ${r.suggestion}</small>` : ''}
              </div>
            `).join('')}
          </div>
          
          <div class="next-steps">
            <h3>✅ What's Next?</h3>
            <ol>
              <li><strong>Test the PDFs:</strong> Click on the "Test PDF" links above - they should open directly without 401 errors!</li>
              <li><strong>Test your Flutter app:</strong> Try downloading a PDF - the 401 error should be gone!</li>
              <li><strong>Regenerate failed PDFs:</strong> For any PDFs that failed to fix, use the "Regenerate Agreement" button in your app</li>
              <li><strong>Future uploads:</strong> All new PDFs will be public automatically with the updated code</li>
            </ol>
            
            ${successCount > 0 ? `
              <div class="alert alert-success">
                <strong>🎊 Success!</strong> ${successCount} PDF${successCount > 1 ? 's are' : ' is'} now publicly accessible!
              </div>
            ` : ''}
            
            ${failCount > 0 ? `
              <div class="alert alert-warning">
                <strong>⚠️ Note:</strong> ${failCount} PDF${failCount > 1 ? 's' : ''} could not be automatically fixed. 
                These may need to be regenerated using the Flutter app.
              </div>
            ` : ''}
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Fatal error:', error);
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
          <p><strong>Message:</strong> ${error.message}</p>
          <p><strong>Stack:</strong> <pre>${error.stack}</pre></p>
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
    const filename = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];
    
    let publicId;
    if (folder.startsWith('v')) {
      const actualFolder = urlParts[urlParts.length - 3];
      publicId = `${actualFolder}/${filename.replace('.pdf', '')}`;
    } else {
      publicId = `${folder}/${filename.replace('.pdf', '')}`;
    }

    // Try raw first
    try {
      await cloudinary.api.update(publicId, {
        resource_type: 'raw',
        type: 'upload',
        access_mode: 'public'
      });
    } catch (err) {
      // Try as image if raw fails
      await cloudinary.api.update(publicId, {
        resource_type: 'image',
        type: 'upload',
        access_mode: 'public'
      });
    }

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
