const mongoose = require('mongoose');

const propertyViewSchema = new mongoose.Schema({
  propertyId: { type: String, required: true },
  ownerId:    { type: String, required: true },
  tenantEmail: { type: String, required: true },
  tenantName:  { type: String, default: '' },
  tenantPhone: { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.model('PropertyView', propertyViewSchema);