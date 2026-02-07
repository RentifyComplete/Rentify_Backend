// ========================================
// PROPERTY ROUTES - WITH AGREEMENT SUPPORT & PUBLIC PDF ACCESS
// File: routes/properties.js
// ✅ Added 'rooms' field handling
// ✅ Added agreement URL fields
// ✅ Sets serviceDueDate on property creation
// ✅ Calculates initial service charge
// ✅ PUBLIC PDF uploads configured
// ✅ Batch PDF access fix route
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

// ⭐⭐⭐ NEW: Helper function for PUBLIC PDF uploads ⭐⭐⭐
async function uploadPDFToCloudinary(filePath, filename) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rental_agreements',
      resource_type: 'raw',
      public_id: filename,
      type: 'upload',           // ⭐ KEY FIX
      access_mode: 'public',    // ⭐ MAKES PDF PUBLIC
      overwrite: true,
    });
    
    console.log('✅ PDF uploaded as PUBLIC:', result.secure_url);
    
    // Clean up local file
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

// ⭐⭐⭐ NEW ROUTE: Fix single PDF access ⭐⭐⭐
router.post('/fix-pdf-access/:propertyId', async (req, res) => {
  try {
    const property = await Property.findById(req.params.propertyId);
    
    if (!property || !property.agreementUrl) {
      return res.status(404).json({
        success: false,
        message: 'Property or agreement not found'
      });
    }

    // Extract public_id from Cloudinary URL
    const urlParts = property.agreementUrl.split('/');
    const publicIdWithExt = urlParts.slice(-2).join('/'); // rental_agreements/filename.pdf
    const publicId = publicIdWithExt.replace('.pdf', '');

    console.log('🔓 Making PDF public:', publicId);

    // Update the resource to be public
    const result = await cloudinary.api.update(publicId, {
      resource_type: 'raw',
      type: 'upload',
      access_mode: 'public'
    });

    console.log('✅ PDF is now public');

    res.status(200).json({
      success: true,
      message: 'PDF access updated to public',
      url: result.secure_url
    });

  } catch (error) {
    console.error('❌ Error updating PDF access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update PDF access',
      error: error.message
    });
  }
});

// ⭐⭐⭐ NEW ROUTE: Batch fix all PDFs ⭐⭐⭐
router.post('/admin/fix-all-pdfs', async (req, res) => {
  try {
    console.log('🔧 Fixing all PDF access...');
    
    // Get all properties with agreement URLs
    const properties = await Property.find({ 
      agreementUrl: { $exists: true, $ne: null } 
    });

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
          propertyId: property._id,
          propertyTitle: property.title,
          status: 'fixed',
          url: property.agreementUrl
        });
        
        console.log(`✅ Fixed: ${property.title}`);
      } catch (err) {
        results.push({
          propertyId: property._id,
          propertyTitle: property.title,
          status: 'failed',
          error: err.message
        });
        console.error(`❌ Failed: ${property.title}`, err.message);
      }
    }

    const successCount = results.filter(r => r.status === 'fixed').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    res.status(200).json({
      success: true,
      message: `Fixed ${successCount} PDFs, ${failCount} failed`,
      totalProcessed: results.length,
      successCount,
      failCount,
      results
    });

  } catch (error) {
    console.error('❌ Batch fix failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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
      ownerName,        // ⭐ NEW
      signatureUrl,     // ⭐ NEW
      agreementUrl,     // ⭐ NEW
    } = req.body;

    console.log('📝 Creating new property...');
    console.log('  Title:', title);
    console.log('  Type:', type);
    console.log('  Beds:', beds);
    console.log('  Rooms:', rooms);
    console.log('  Owner ID:', ownerId);
    console.log('  Owner Name:', ownerName);
    console.log('  Signature URL:', signatureUrl ? 'Provided' : 'Not provided');
    console.log('  Agreement URL:', agreementUrl ? 'Provided' : 'Not provided');

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
      rooms: rooms ? parseInt(rooms) : undefined,
      amenities: typeof amenities === 'string' ? JSON.parse(amenities) : amenities,
      description,
      address,
      city,
      state,
      zipCode,
      ownerId,
      images: imageUrls,
      ownerName,        // ⭐ NEW
      signatureUrl,     // ⭐ NEW
      agreementUrl,     // ⭐ NEW
    });

    // ⭐ Set agreement generated timestamp if URL provided
    if (agreementUrl) {
      property.agreementGeneratedAt = new Date();
      console.log('📄 Agreement URL saved:', agreementUrl);
    }

    // ⭐ Set up service charge subscription
    const now = new Date();
    property.serviceDueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    property.serviceStatus = 'active';
    property.lastServicePayment = now;
    property.monthlyServiceCharge = property.calculateServiceCharge();

    // ⭐ Link the initial payment from temporary storage
    try {
      const owner = await User.findById(ownerId);
      if (owner && owner.tempPropertyPayment) {
        const tempPayment = owner.tempPropertyPayment;
        
        if (new Date() < tempPayment.expiresAt) {
          console.log('🔗 Linking initial payment to property');
          
          property.servicePaymentHistory = [{
            amount: tempPayment.amount,
            monthsPaid: 1,
            paymentId: tempPayment.paymentId,
            orderId: tempPayment.orderId,
            paymentType: 'property_addition',
            status: 'completed',
            paidAt: tempPayment.paidAt,
          }];
          
          await User.findByIdAndUpdate(ownerId, {
            $unset: { tempPropertyPayment: 1 }
          });
          
          console.log('✅ Initial payment linked successfully');
          console.log('🎁 First month FREE activated');
        } else {
          console.log('⚠️ Temporary payment expired');
        }
      }
    } catch (linkError) {
      console.error('⚠️ Error linking payment:', linkError.message);
    }

    console.log('💰 Service charge setup:');
    console.log('  Monthly charge: ₹' + property.monthlyServiceCharge);
    console.log('  Due date: ' + property.serviceDueDate.toISOString());
    console.log('  Status: ' + property.serviceStatus);
    if (rooms) console.log('  Rooms: ' + rooms);
    if (agreementUrl) console.log('  Agreement: Generated and saved');

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
      agreementUrl,        // ⭐ NEW: Accept agreementUrl
      ownerName,           // ⭐ NEW: Accept ownerName
      signatureUrl,        // ⭐ NEW: Accept signatureUrl
    } = req.body;

    console.log('🔄 Updating property:', req.params.id);
    console.log('  Fields to update:', Object.keys(req.body));

    // ⭐ Update basic fields
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

    // ⭐⭐⭐ NEW: Update agreement and owner fields ⭐⭐⭐
    if (agreementUrl !== undefined) {
      property.agreementUrl = agreementUrl;
      property.agreementGeneratedAt = new Date();
      console.log('📄 Agreement URL updated:', agreementUrl);
    }
    if (ownerName !== undefined) {
      property.ownerName = ownerName;
      console.log('👤 Owner name updated:', ownerName);
    }
    if (signatureUrl !== undefined) {
      property.signatureUrl = signatureUrl;
      console.log('✍️ Signature URL updated:', signatureUrl);
    }
    // ⭐⭐⭐ END NEW FIELDS ⭐⭐⭐

    // ⭐ Recalculate service charge if type/beds/bhk/rooms changed
    if (type || bhk || beds || rooms) {
      const oldCharge = property.monthlyServiceCharge;
      property.monthlyServiceCharge = property.calculateServiceCharge();
      
      if (oldCharge !== property.monthlyServiceCharge) {
        console.log(`💰 Service charge updated: ₹${oldCharge} → ₹${property.monthlyServiceCharge}`);
      }
    }

    // Handle image uploads (if any files were sent)
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} new images...`);
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
      console.log(`✅ Added ${newImageUrls.length} new images`);
    }

    const updatedProperty = await property.save();

    console.log('✅ Property updated successfully');

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

    console.log(`🗑️  Property soft-deleted: ${property._id}`);

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
    
    const properties = await Property.find({
      ownerId: req.params.ownerId,
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${properties.length} properties for owner`);
    
    // ⭐ Log agreement status for debugging
    properties.forEach(prop => {
      console.log(`  📋 ${prop.title}:`);
      console.log(`     - Agreement URL: ${prop.agreementUrl ? 'Yes' : 'No'}`);
      console.log(`     - Signature URL: ${prop.signatureUrl ? 'Yes' : 'No'}`);
      console.log(`     - Owner Name: ${prop.ownerName || 'Not set'}`);
    });

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

// ⭐⭐⭐ EXPORT uploadPDFToCloudinary for use in other routes ⭐⭐⭐
module.exports = router;
module.exports.uploadPDFToCloudinary = uploadPDFToCloudinary;