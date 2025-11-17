const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Calculate service charge based on property type
function calculateServiceCharge(propertyType, beds, bhk) {
  const RATE_PER_UNIT = 18; // ₹18 per bed/bedroom
  
  if (propertyType === 'PG') {
    // For PG: charge per bed
    return beds * RATE_PER_UNIT;
  } else if (propertyType === 'Flat' || propertyType === 'Apartment') {
    // For Flat/Apartment: charge per bedroom (bhk)
    const bedroomCount = parseInt(bhk) || 1;
    return bedroomCount * RATE_PER_UNIT;
  }
  
  // Default: 1 unit charge
  return RATE_PER_UNIT;
}

// Create Razorpay order
router.post('/create-order', async (req, res) => {
  try {
    const { propertyType, beds, bhk, propertyTitle } = req.body;
    
    // Calculate service charge
    const amount = calculateServiceCharge(propertyType, beds, bhk);
    
    // Create Razorpay order
    const options = {
      amount: amount * 100, // Convert to paise (Razorpay uses smallest currency unit)
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: {
        propertyType,
        beds: beds || 0,
        bhk: bhk || 0,
        propertyTitle,
      },
    };
    
    const order = await razorpay.orders.create(options);
    
    console.log('✅ Razorpay order created:', order.id);
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: amount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating Razorpay order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message,
    });
  }
});

// Verify payment signature
router.post('/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      propertyData,
    } = req.body;
    
    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature === expectedSign) {
      console.log('✅ Payment signature verified successfully');
      
      // Store payment details in database
      const paymentRecord = {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        propertyId: propertyData.propertyId,
        ownerId: propertyData.ownerId,
        amount: propertyData.amount,
        status: 'success',
        createdAt: new Date(),
      };
      
      // TODO: Save to payments collection in MongoDB
      // await db.collection('payments').insertOne(paymentRecord);
      
      res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        paymentId: razorpay_payment_id,
      });
    } else {
      console.error('❌ Invalid payment signature');
      res.status(400).json({
        success: false,
        message: 'Invalid payment signature',
      });
    }
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: error.message,
    });
  }
});

// Get payment details
router.get('/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await razorpay.payments.fetch(paymentId);
    
    res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error('❌ Error fetching payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details',
    });
  }
});

module.exports = router;
