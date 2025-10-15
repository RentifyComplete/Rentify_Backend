const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup for file upload
const upload = multer({ dest: 'uploads/' });

// Upload property with images
router.post('/', upload.array('images', 5), async (req, res) => {
  try {
    const { title, price, location, description, ownerId } = req.body;

    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'rentify_properties'
        });
        imageUrls.push(result.secure_url);
        fs.unlinkSync(file.path); // Delete local file
      }
    }

    const property = new Property({
      title,
      price,
      location,
      description,
      ownerId,
      images: imageUrls
    });

    const savedProperty = await property.save();
    res.status(201).json({ success: true, data: savedProperty });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all properties
router.get('/', async (req, res) => {
  try {
    const properties = await Property.find();
    res.json(properties);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete property
router.delete('/:id', async (req, res) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id);
    if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
    res.json({ success: true, message: 'Property deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
