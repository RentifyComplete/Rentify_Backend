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

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log('✅ Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME);

// Property Schema
const propertySchema = new mongoose.Schema({
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
}, { timestamps: true });

const Property = mongoose.model('Property', propertySchema, 'properties');

// Multer configuration for temporary storage
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
    cb(new Error('Only images are allowed'));
  }
});

// Helper function to upload to Cloudinary
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rentify_properties',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' }
      ]
    });
    
    // Delete local file after upload
    fs.unlinkSync(filePath);
    
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    throw error;
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    cloudinary: process.env.CLOUDINARY_CLOUD_NAME 
  });
});

// Create Property with Cloudinary Images
app.post('/api/properties', upload.array('images', 10), async (req, res) => {
  try {
    console.log('📤 Received property submission');
    console.log('📷 Number of images:', req.files?.length || 0);

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

    // Upload images to Cloudinary
    const imageUrls = [];
    
    if (req.files && req.files.length > 0) {
      console.log('☁️  Uploading images to Cloudinary...');
      
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        console.log(`   Uploading image ${i + 1}/${req.files.length}...`);
        
        try {
          const url = await uploadToCloudinary(file.path);
          imageUrls.push(url);
          console.log(`   ✅ Image ${i + 1} uploaded`);
        } catch (error) {
          console.error(`   ❌ Failed to upload image ${i + 1}:`, error);
        }
      }
    }
    
    console.log('🖼️  Total images uploaded:', imageUrls.length);

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
    
    console.log('✅ Property created:', property._id);
    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property,
    });
  } catch (error) {
    console.error('❌ Error creating property:', error);
    
    // Clean up uploaded files if there's an error
    if (req.files) {
      req.files.forEach(file => {
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

// Get All Properties
app.get('/api/properties', async (req, res) => {
  try {
    const properties = await Property.find({ isActive: true })
      .sort({ createdAt: -1 });
    
    console.log(`📦 Fetched ${properties.length} properties`);
    
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

// Get Property by ID
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

// Get Properties by Owner
app.get('/api/properties/owner/:ownerId', async (req, res) => {
  try {
    const properties = await Property.find({ 
      ownerId: req.params.ownerId,
      isActive: true 
    }).sort({ createdAt: -1 });
    
    res.json({
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

// Update Property
app.put('/api/properties/:id', upload.array('images', 10), async (req, res) => {
  try {
    const updates = { ...req.body };
    
    // If new images uploaded, upload to Cloudinary
    if (req.files && req.files.length > 0) {
      const imageUrls = [];
      
      for (const file of req.files) {
        try {
          const url = await uploadToCloudinary(file.path);
          imageUrls.push(url);
        } catch (error) {
          console.error('Failed to upload image:', error);
        }
      }
      
      updates.images = imageUrls;
    }

    const property = await Property.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Property updated successfully',
      data: property,
    });
  } catch (error) {
    console.error('❌ Error updating property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update property',
      error: error.message,
    });
  }
});

// Delete Property (Soft delete)
app.delete('/api/properties/:id', async (req, res) => {
  try {
    const property = await Property.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }
    
    res.json({
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

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API available at http://localhost:${PORT}`);
});