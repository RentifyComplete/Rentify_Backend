const express = require('express');
const router  = express.Router();
const PropertyView = require('../models/PropertyView');

// POST /api/property-views/record
router.post('/record', async (req, res) => {
  try {
    const { propertyId, ownerId, tenantEmail, tenantName, tenantPhone } = req.body;

    if (!propertyId || !ownerId || !tenantEmail) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Avoid duplicate views from same tenant for same property (within 24 hrs)
    const existing = await PropertyView.findOne({
      propertyId,
      tenantEmail,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (existing) {
      return res.json({ success: true, message: 'View already recorded today' });
    }

    const view = new PropertyView({ propertyId, ownerId, tenantEmail, tenantName, tenantPhone });
    await view.save();

    console.log(`👁️ View recorded: ${tenantEmail} viewed property ${propertyId}`);
    res.status(201).json({ success: true, message: 'View recorded' });
  } catch (error) {
    console.error('❌ Error recording view:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/property-views/owner/:ownerId
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const views = await PropertyView.find({ ownerId: req.params.ownerId })
      .sort({ createdAt: -1 });
    res.json({ success: true, views });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;