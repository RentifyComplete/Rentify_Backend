const mongoose = require('mongoose');

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

module.exports = mongoose.model('Property', propertySchema, 'properties');
