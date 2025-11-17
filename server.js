const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes - payment
const paymentRoutes = require('./routes/payment');
app.use('/api/payments', paymentRoutes);

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

// ------------------- Schemas -------------------

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

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  password: String, // hashed password
}, { timestamps: true });

const User = mongoose.model('User', userSchema, 'users');

// OTP Schema
const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

const OTP = mongoose.model('OTP', otpSchema, 'otps');

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
  }
});

// ------------------- Cloudinary Helper -------------------
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rentify_properties',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' }
      ]
    });
    fs.unlinkSync(filePath);
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    throw error;
  }
}

// ------------------- Nodemailer Setup -------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'rentify085@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD,
  }
});

// ------------------- Routes -------------------

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    cloudinary: process.env.CLOUDINARY_CLOUD_NAME 
  });
});

// ------------------- SEND OTP -------------------
app.post('/api/send-reset-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'Email not found' });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    // Save OTP in DB
    await OTP.create({ email, code: otpCode, expiresAt });

    // Send email
    await transporter.sendMail({
      from: '"Rentify App" <rentify085@gmail.com>',
      to: email,
      subject: 'Your Rentify Password Reset OTP',
      html: `<p>Your OTP for password reset is: <b>${otpCode}</b></p>`
    });

    console.log(`✅ OTP sent to ${email}: ${otpCode}`);
    res.json({ success: true, message: 'OTP sent to your email' });

  } catch (error) {
    console.error('❌ Error sending OTP:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: error.message });
  }
});

// ------------------- VERIFY OTP -------------------
app.post('/api/verify-otp', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) return res.status(400).json({ success: false, message: 'Email and OTP are required' });

  try {
    const otpEntry = await OTP.findOne({ email, code }).sort({ createdAt: -1 });

    if (!otpEntry) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (otpEntry.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'OTP expired' });

    // OTP is valid, delete it from DB
    await OTP.deleteOne({ _id: otpEntry._id });

    res.json({ success: true, message: 'OTP verified successfully' });

  } catch (error) {
    console.error('❌ Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Failed to verify OTP', error: error.message });
  }
});

// ------------------- Property Routes -------------------

// Create Property
app.post('/api/properties', upload.array('images', 10), async (req, res) => {
  try {
    const { title, location, price, type, bhk, beds, amenities, description, address, city, state, zipCode, ownerId } = req.body;

    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.path);
        imageUrls.push(url);
      }
    }

    const property = new Property({
      title, location, price, type, bhk, beds: beds ? parseInt(beds) : undefined,
      amenities: typeof amenities === 'string' ? JSON.parse(amenities) : amenities,
      description, address, city, state, zipCode, ownerId, images: imageUrls
    });

    await property.save();
    res.status(201).json({ success: true, message: 'Property created successfully', data: property });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to create property', error: error.message });
  }
});

// ------------------- Uploads Directory -------------------
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API available at http://localhost:${PORT}`);
});
