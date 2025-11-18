// server.js
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ------------------- Middleware -------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------- Request Logger (DEBUG) -------------------
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// ------------------- MongoDB Connection -------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ------------------- Cloudinary Configuration -------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
console.log('✅ Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME);

// ------------------- Property Schema -------------------
const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    location: { type: String, required: true },
    price: { type: String, required: true },
    type: { type: String, required: true },

    bhk: String,
    beds: Number,
    amenities: [String],
    description: { type: String, required: true },

    address: String,
    city: String,
    state: String,
    zipCode: String,

    ownerId: { type: String, required: true },
    images: [String],

    rating: { type: Number, default: 4.5 },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Property = mongoose.model('Property', propertySchema, 'properties');

// ------------------- Multer Configuration -------------------
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed'));
  },
});

// ------------------- Cloudinary Upload Helper -------------------
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rentify_properties',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' },
      ],
    });

    // Delete local file after upload
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    throw error;
  }
}

// ------------------- Health Check Route -------------------
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Rentify API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    routes: [
      'GET /',
      'POST /api/auth/send-reset-otp',
      'POST /api/auth/verify-otp',
      'POST /api/auth/reset-password',
      'POST /api/properties',
      'POST /api/payments/*'
    ]
  });
});

// ------------------- Routes -------------------
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const paymentRoutes = require('./routes/payment');
app.use('/api/payments', paymentRoutes);

// ------------------- Property Upload Route -------------------
app.post('/api/properties', upload.array('images', 10), async (req, res) => {
  try {
    console.log('📦 Property creation request received');
    console.log('Files:', req.files?.length || 0);
    console.log('Body:', req.body);

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

    // Validation
    if (!title || !location || !price || !type || !description || !ownerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, location, price, type, description, ownerId',
      });
    }

    // Upload images to Cloudinary
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`📤 Uploading ${req.files.length} images to Cloudinary...`);
      for (const file of req.files) {
        try {
          const url = await uploadToCloudinary(file.path);
          imageUrls.push(url);
          console.log(`✅ Uploaded: ${url}`);
        } catch (uploadError) {
          console.error(`❌ Failed to upload ${file.originalname}:`, uploadError);
        }
      }
    }

    // Parse amenities if it's a string
    let parsedAmenities = amenities;
    if (typeof amenities === 'string') {
      try {
        parsedAmenities = JSON.parse(amenities);
      } catch (e) {
        parsedAmenities = amenities.split(',').map(a => a.trim());
      }
    }

    // Create property
    const property = new Property({
      title,
      location,
      price,
      type,
      bhk,
      beds: beds ? parseInt(beds) : undefined,
      amenities: parsedAmenities,
      description,
      address,
      city,
      state,
      zipCode,
      ownerId,
      images: imageUrls,
    });

    await property.save();
    console.log('✅ Property saved:', property._id);

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property,
    });
  } catch (error) {
    console.error('❌ Property creation error:', error);

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

// ------------------- Get All Properties -------------------
app.get('/api/properties', async (req, res) => {
  try {
    const properties = await Property.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({
      success: true,
      count: properties.length,
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

// ------------------- Get Property by ID -------------------
app.get('/api/properties/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }
    res.json({
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

// ------------------- 404 Handler -------------------
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.url}`,
    availableRoutes: [
      'GET /',
      'GET /api/properties',
      'GET /api/properties/:id',
      'POST /api/auth/send-reset-otp',
      'POST /api/auth/verify-otp',
      'POST /api/auth/reset-password',
      'POST /api/properties',
    ]
  });
});

// ------------------- Error Handler -------------------
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  
  // Multer errors
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message,
    });
  }
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// ------------------- Create Uploads Directory -------------------
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
  console.log('📁 Created uploads directory');
}

// ------------------- Start Server -------------------
app.listen(PORT, () => {
  console.log('\n🚀 ================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 Email configured: ${process.env.EMAIL_USERNAME ? '✅ Yes' : '❌ No'}`);
  console.log(`☁️  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ Yes' : '❌ No'}`);
  console.log(`🗄️  MongoDB: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '⏳ Connecting...'}`);
  console.log('🚀 ================================\n');
});