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
const PORT = process.env.PORT || 5000;

// ------------------- Middleware -------------------
app.use(cors());
app.use(express.json());

// ------------------- Routes -------------------
const paymentRoutes = require('./routes/payment');
app.use('/api/payments', paymentRoutes);

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ------------------- MongoDB Connection -------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

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

// ------------------- Multer -------------------
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images are allowed'));
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

    fs.unlinkSync(filePath);
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    throw error;
  }
}

// ------------------- Property Upload Route -------------------
app.post('/api/properties', upload.array('images', 10), async (req, res) => {
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

    const imageUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.path);
        imageUrls.push(url);
      }
    }

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

    await property.save();

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property,
    });
  } catch (error) {
    console.error(error);

    // Cleanup on error
    if (req.files) {
      req.files.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create property',
      error: error.message,
    });
  }
});

// ------------------- Uploads Directory -------------------
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ------------------- Start Server -------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API available at http://localhost:${PORT}`);
});
