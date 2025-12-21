// routes/payment.js
// ⭐ COMPLETE FIXED VERSION - All Payment Types Working
const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/user');
const Property = require('../models/Property');
const Booking = require('../models/Booking');

// ========================================
// RAZORPAY INITIALIZATION
// ========================================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

console.log('🔑 Razorpay initialized:', !!razorpay);
const ROUTE_API_AVAILABLE = typeof razorpay.contacts !== 'undefined' && typeof razorpay.fundAccount !== 'undefined';

// ========================================
// HELPER FUNCTIONS & CONSTANTS
// ========================================
function calculateServiceCharge(propertyType, beds, bhk) {
  const RATE_PER_UNIT = 18;
  let charge = RATE_PER_UNIT;
  if (propertyType === 'PG') {
    charge = (parseInt(beds) || 1) * RATE_PER_UNIT;
  } else if (propertyType === 'Flat' || propertyType === 'Apartment') {
    if (bhk) {
      const match = bhk.match(/(\d+)/);
      if (match) charge = parseInt(match[1]) * RATE_PER_UNIT;
    }
  }
  return Math.max(charge, RATE_PER_UNIT);
}

const VALID_COUPONS = {
  'RENTIFY25': 25,
  'RENTIFY50': 50,
  'RENTIFY100': 100,
};

function validateAndApplyCoupon(originalAmount, couponCode) {
  if (!couponCode) {
    return { valid: true, finalAmount: originalAmount, discount: 0, discountPercent: 0 };
  }
  const couponUpper = couponCode.toUpperCase();
  if (!VALID_COUPONS[couponUpper]) {
    return { valid: false, error: 'Invalid coupon code' };
  }
  const discountPercent = VALID_COUPONS[couponUpper];
  const discountAmount = Math.round((originalAmount * discountPercent) / 100);
  let finalAmount = originalAmount - discountAmount;
  if (discountPercent === 100 && finalAmount === 0) finalAmount = 1;
  return { valid: true, finalAmount, discount: discountAmount, discountPercent, couponCode: couponUpper };
}

const SERVICE_CHARGE_PRICING = {
  1: { months: 1, price: 499, discount: 0 },
  3: { months: 3, price: 1299, discount: 13 },
  6: { months: 6, price: 2399, discount: 20 },
  12: { months: 12, price: 4499, discount: 25 }
};

const TENANT_RENT_PRICING = {
  1: { months: 1, discount: 0 },
  3: { months: 3, discount: 5 },
  6: { months: 6, discount: 10 },
  12: { months: 12, discount: 15 }
};

// ========================================
// TENANT PAYMENT ROUTES
// ========================================

// ⭐ GET TENANT PAYMENT HISTORY
router.get('/tenant/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log('📜 ==================== TENANT PAYMENT HISTORY ====================');
    console.log('📧 Tenant Email:', email);
    
    if (!email || email.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Email parameter is required'
      });
    }
    
    const bookings = await Booking.find({ 
      tenantEmail: email.trim().toLowerCase()
    }).sort({ createdAt: -1 });
    
    console.log('📋 Found', bookings.length, 'bookings for tenant');
    
    if (bookings.length === 0) {
      console.log('⚠️ No bookings found for:', email);
      return res.json({
        success: true,
        payments: [],
        totalPayments: 0,
        totalAmount: 0,
        message: 'No bookings found for this tenant'
      });
    }
    
    const allPayments = [];
    let totalAmount = 0;
    
    for (const booking of bookings) {
      console.log(`📦 Processing booking ${booking._id}:`);
      console.log(`   - Property: ${booking.propertyTitle || booking.propertyId}`);
      console.log(`   - Payments in history: ${booking.rentPaymentHistory?.length || 0}`);
      
      let propertyTitle = booking.propertyTitle || 'Property';
      let propertyAddress = booking.propertyAddress || '';
      
      if (!booking.propertyTitle && booking.propertyId) {
        try {
          const property = await Property.findById(booking.propertyId);
          if (property) {
            propertyTitle = property.title || 'Property';
            propertyAddress = property.address || '';
          }
        } catch (err) {
          console.log('⚠️ Could not fetch property details:', err.message);
        }
      }
      
      if (booking.rentPaymentHistory && booking.rentPaymentHistory.length > 0) {
        booking.rentPaymentHistory.forEach((payment, index) => {
          console.log(`   💰 Payment ${index + 1}:`, {
            amount: payment.amount,
            paidAt: payment.paidAt,
            paymentId: payment.paymentId
          });
          
          const paymentDate = payment.paidAt || payment.createdAt || booking.createdAt;
          
          allPayments.push({
            _id: payment._id || payment.paymentId,
            bookingId: booking._id.toString(),
            propertyId: booking.propertyId,
            propertyTitle: propertyTitle,
            propertyAddress: propertyAddress,
            amount: Number(payment.amount || 0),
            monthsPaid: Number(payment.monthsPaid || 1),
            convenienceFee: Number(payment.convenienceFee || 0),
            date: paymentDate,
            paidOn: paymentDate,
            status: 'paid',
            method: 'Razorpay',
            transactionId: payment.paymentId || '',
            razorpayOrderId: payment.orderId || '',
            month: new Date(paymentDate).toLocaleDateString('en-US', { 
              month: 'long', 
              year: 'numeric' 
            }),
          });
          
          totalAmount += Number(payment.amount || 0);
        });
      } else {
        console.log('   ⚠️ No payment history found for this booking');
      }
    }
    
    allPayments.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log('✅ Total payments found:', allPayments.length);
    console.log('💰 Total amount:', totalAmount);
    console.log('📜 ==================== HISTORY SUCCESS ====================\n');
    
    res.json({
      success: true,
      payments: allPayments,
      totalPayments: allPayments.length,
      totalAmount: totalAmount
    });
    
  } catch (error) {
    console.error('❌ Error fetching tenant payment history:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history',
      error: error.message
    });
  }
});

// CREATE TENANT RENT ORDER
router.post('/create-tenant-rent-order', async (req, res) => {
  try {
    const { bookingId, propertyId, monthsDuration, couponCode } = req.body;
    
    console.log('💰 ==================== TENANT RENT ORDER ====================');
    console.log('Booking ID:', bookingId);
    console.log('Property ID:', propertyId);
    console.log('Months Duration:', monthsDuration);
    console.log('Coupon Code:', couponCode || 'None');
    
    if (!bookingId || !propertyId || !monthsDuration) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: bookingId, propertyId, monthsDuration'
      });
    }
    
    if (![1, 3, 6, 12].includes(parseInt(monthsDuration))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid duration. Must be 1, 3, 6, or 12 months'
      });
    }
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    const pricing = TENANT_RENT_PRICING[monthsDuration];
    const monthlyRent = booking.monthlyRent;
    const baseAmount = monthlyRent * pricing.months;
    const durationDiscount = Math.round((baseAmount * pricing.discount) / 100);
    const afterDurationDiscount = baseAmount - durationDiscount;
    const convenienceFee = Math.round((afterDurationDiscount * 2.7) / 100);
    let finalAmount = afterDurationDiscount + convenienceFee;
    
    console.log('💵 Calculation:');
    console.log('   Monthly Rent: ₹' + monthlyRent);
    console.log('   Months: ' + pricing.months);
    console.log('   Base Amount: ₹' + baseAmount);
    console.log('   Duration Discount (' + pricing.discount + '%): -₹' + durationDiscount);
    console.log('   After Discount: ₹' + afterDurationDiscount);
    console.log('   Convenience Fee (2.7%): +₹' + convenienceFee);
    console.log('   Final Amount: ₹' + finalAmount);
    
    const couponResult = validateAndApplyCoupon(finalAmount, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({
        success: false,
        message: couponResult.error,
      });
    }

    if (couponResult.finalAmount !== finalAmount) {
      console.log('🎟️ Coupon Applied:', couponResult.couponCode);
      finalAmount = couponResult.finalAmount;
      console.log('💰 New Final Amount: ₹' + finalAmount);
    }
    
    const amountInPaise = Math.round(finalAmount * 100);
    
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rent_${Date.now()}`.substring(0, 40),
      notes: {
        type: 'tenant_rent_payment',
        bookingId: bookingId,
        propertyId: propertyId,
        tenantEmail: booking.tenantEmail,
        monthsDuration: pricing.months,
        monthlyRent: monthlyRent,
        baseAmount: baseAmount,
        durationDiscount: durationDiscount,
        convenienceFee: convenienceFee,
        couponCode: couponResult.couponCode || 'none',
        couponDiscount: couponResult.discount || 0,
        finalAmount: finalAmount,
      },
    });
    
    console.log('✅ Order created:', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
      baseAmount: afterDurationDiscount,
      convenienceFee: convenienceFee,
      durationDiscount: durationDiscount,
      couponDiscount: couponResult.discount || 0,
      couponPercent: couponResult.discountPercent || 0,
      couponCode: couponResult.couponCode,
      monthsDuration: pricing.months,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating tenant rent order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message,
    });
  }
});

// VERIFY TENANT RENT PAYMENT
router.post('/verify-tenant-rent-payment', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      bookingId,
      monthsDuration 
    } = req.body;
    
    console.log('🔍 ==================== VERIFY RENT PAYMENT ====================');
    console.log('Order ID:', razorpay_order_id);
    console.log('Payment ID:', razorpay_payment_id);
    console.log('Booking ID:', bookingId);
    console.log('Months Duration:', monthsDuration);
    
    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature !== expectedSign) {
      console.error('❌ Invalid payment signature');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid signature' 
      });
    }
    
    console.log('✅ Payment signature verified');
    
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    console.log('💳 Payment details from Razorpay:', {
      amount: payment.amount,
      status: payment.status,
      method: payment.method
    });
    
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      console.error('❌ Payment not successful. Status:', payment.status);
      return res.status(400).json({
        success: false,
        message: 'Payment not completed. Status: ' + payment.status
      });
    }
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    console.log('📋 Booking found for tenant:', booking.tenantEmail);
    console.log('📅 Current due date:', booking.rentDueDate);
    
    const monthsDurationInt = parseInt(monthsDuration);
    const pricing = TENANT_RENT_PRICING[monthsDurationInt];
    
    if (!pricing) {
      console.error('❌ Invalid months duration:', monthsDuration);
      return res.status(400).json({
        success: false,
        message: 'Invalid months duration: ' + monthsDuration
      });
    }
    
    const totalAmount = payment.amount / 100;
    const baseAmount = booking.monthlyRent * pricing.months;
    const durationDiscount = Math.round((baseAmount * pricing.discount) / 100);
    const afterDiscount = baseAmount - durationDiscount;
    const convenienceFee = Math.round((afterDiscount * 2.7) / 100);
    
    const paymentData = {
      amount: totalAmount,
      monthsPaid: pricing.months,
      convenienceFee: convenienceFee,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    };
    
    console.log('💾 Recording rent payment:', JSON.stringify(paymentData, null, 2));
    
    try {
      await booking.recordRentPayment(paymentData);
      console.log('✅ Rent payment recorded successfully');
      console.log('📅 New due date:', booking.rentDueDate);
      console.log('📊 Total payments in history:', booking.rentPaymentHistory.length);
    } catch (saveError) {
      console.error('❌ Error saving rent payment:', saveError);
      console.error('Stack:', saveError.stack);
      return res.status(500).json({
        success: false,
        message: 'Payment verified but failed to update booking',
        error: saveError.message
      });
    }
    
    console.log('🔍 ==================== VERIFY SUCCESS ====================\n');
    
    res.json({ 
      success: true, 
      paymentId: razorpay_payment_id,
      verified: true,
      newDueDate: booking.rentDueDate,
      status: booking.status,
      totalPayments: booking.rentPaymentHistory.length,
      message: `Rent paid for ${pricing.months} month(s)`
    });
    
  } catch (error) {
    console.error('❌ Error verifying rent payment:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================
// OWNER SERVICE CHARGE ROUTES
// ========================================

// ⭐ GET OWNER'S SERVICE CHARGE PAYMENTS
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    console.log('📜 ==================== OWNER PAYMENT HISTORY ====================');
    console.log('👤 Owner ID:', ownerId);
    
    if (!ownerId || ownerId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Owner ID parameter is required'
      });
    }
    
    const properties = await Property.find({ ownerId: ownerId.trim() });
    
    console.log('🏠 Found', properties.length, 'properties for owner');
    
    if (properties.length === 0) {
      console.log('⚠️ No properties found for owner:', ownerId);
      return res.json({
        success: true,
        payments: [],
        totalPayments: 0,
        totalAmount: 0,
        message: 'No properties found for this owner'
      });
    }
    
    const allPayments = [];
    let totalAmount = 0;
    
    for (const property of properties) {
      console.log(`📦 Processing property ${property._id}:`);
      console.log(`   - Title: ${property.title}`);
      console.log(`   - Payments in history: ${property.servicePaymentHistory?.length || 0}`);
      
      if (property.servicePaymentHistory && property.servicePaymentHistory.length > 0) {
        property.servicePaymentHistory.forEach((payment, index) => {
          console.log(`   💰 Payment ${index + 1}:`, {
            amount: payment.amount,
            monthsPaid: payment.monthsPaid,
            paidAt: payment.paidAt,
            paymentId: payment.paymentId
          });
          
          const paymentDate = payment.paidAt || payment.createdAt || property.createdAt;
          
          allPayments.push({
            _id: payment._id || payment.paymentId,
            propertyId: property._id.toString(),
            propertyTitle: property.title,
            propertyType: property.type,
            amount: Number(payment.amount || 0),
            monthsPaid: Number(payment.monthsPaid || 1),
            paymentType: 'service_charge',
            status: payment.status || 'completed',
            date: paymentDate,
            paidAt: paymentDate,
            createdAt: paymentDate,
            paymentDate: paymentDate,
            transactionId: payment.paymentId || '',
            razorpayOrderId: payment.orderId || '',
            validUntil: payment.validUntil,
          });
          
          totalAmount += Number(payment.amount || 0);
        });
      } else {
        console.log('   ℹ️ No payment history for this property');
      }
    }
    
    allPayments.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log('✅ Total payments found:', allPayments.length);
    console.log('💰 Total amount:', totalAmount);
    console.log('📜 ==================== HISTORY SUCCESS ====================\n');
    
    res.json({
      success: true,
      payments: allPayments,
      totalPayments: allPayments.length,
      totalAmount: totalAmount
    });
    
  } catch (error) {
    console.error('❌ Error fetching owner payment history:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history',
      error: error.message
    });
  }
});

// CREATE OWNER SERVICE CHARGE ORDER
router.post('/create-service-charge-order', async (req, res) => {
  try {
    const { propertyId, ownerId, monthsDuration, couponCode } = req.body;
    
    console.log('💰 ==================== OWNER SERVICE CHARGE ORDER ====================');
    console.log('Property ID:', propertyId);
    console.log('Owner ID:', ownerId);
    console.log('Months Duration:', monthsDuration);
    console.log('Coupon Code:', couponCode || 'None');
    
    if (!propertyId || !ownerId || !monthsDuration) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: propertyId, ownerId, monthsDuration'
      });
    }
    
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    const monthlyCharge = calculateServiceCharge(
      property.type, 
      property.beds || property.bedrooms, 
      property.bhk
    );
    
    const baseAmount = monthlyCharge * parseInt(monthsDuration);
    
    console.log('💵 Calculation:');
    console.log('   Monthly Charge: ₹' + monthlyCharge);
    console.log('   Months: ' + monthsDuration);
    console.log('   Base Amount: ₹' + baseAmount);
    
    const couponResult = validateAndApplyCoupon(baseAmount, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({
        success: false,
        message: couponResult.error,
      });
    }

    let finalAmount = couponResult.finalAmount;
    
    if (couponResult.couponCode) {
      console.log('🎟️ Coupon Applied:', couponResult.couponCode);
      console.log('💰 Final Amount: ₹' + finalAmount);
    }
    
    const amountInPaise = Math.round(finalAmount * 100);
    
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `svc_${Date.now()}`.substring(0, 40),
      notes: {
        type: 'owner_service_charge',
        propertyId: propertyId,
        ownerId: ownerId,
        monthsDuration: monthsDuration,
        monthlyCharge: monthlyCharge,
        baseAmount: baseAmount,
        couponCode: couponResult.couponCode || 'none',
        couponDiscount: couponResult.discount || 0,
        finalAmount: finalAmount,
      },
    });
    
    console.log('✅ Order created:', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
      baseAmount: baseAmount,
      couponDiscount: couponResult.discount || 0,
      couponPercent: couponResult.discountPercent || 0,
      couponCode: couponResult.couponCode,
      monthsDuration: monthsDuration,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating service charge order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message,
    });
  }
});

// ⭐ VERIFY OWNER SERVICE CHARGE PAYMENT - FIXED VERSION
router.post('/verify-service-charge-payment', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      propertyId,
      monthsDuration 
    } = req.body;
    
    console.log('🔍 ==================== VERIFY SERVICE CHARGE ====================');
    console.log('Order ID:', razorpay_order_id);
    console.log('Payment ID:', razorpay_payment_id);
    console.log('Property ID:', propertyId);
    console.log('Months Duration:', monthsDuration);
    
    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature !== expectedSign) {
      console.error('❌ Invalid payment signature');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid signature' 
      });
    }
    
    console.log('✅ Payment signature verified');
    
    // ⭐ Fetch payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    console.log('💳 Payment details:', {
      amount: payment.amount,
      status: payment.status,
      method: payment.method
    });
    
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      console.error('❌ Payment not successful. Status:', payment.status);
      return res.status(400).json({
        success: false,
        message: 'Payment not completed. Status: ' + payment.status
      });
    }
    
    // ⭐ Get property and update service status
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    console.log('📋 Property found:', property.title);
    console.log('📅 Current due date:', property.serviceDueDate);
    
    const totalAmount = payment.amount / 100; // Convert from paise
    const monthsDurationInt = parseInt(monthsDuration);
    
    // ⭐ Record payment using Property model method
    const paymentData = {
      amount: totalAmount,
      monthsPaid: monthsDurationInt,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    };
    
    console.log('💾 Recording service charge payment:', JSON.stringify(paymentData, null, 2));
    
    try {
      await property.recordPayment(paymentData);
      console.log('✅ Service charge payment recorded successfully');
      console.log('📅 New due date:', property.serviceDueDate);
      console.log('📊 Total payments in history:', property.servicePaymentHistory.length);
    } catch (saveError) {
      console.error('❌ Error saving payment:', saveError);
      console.error('Stack:', saveError.stack);
      return res.status(500).json({
        success: false,
        message: 'Payment verified but failed to update property',
        error: saveError.message
      });
    }
    
    console.log('🔍 ==================== VERIFY SUCCESS ====================\n');
    
    res.json({ 
      success: true, 
      paymentId: razorpay_payment_id,
      verified: true,
      newDueDate: property.serviceDueDate,
      status: property.serviceStatus,
      totalPayments: property.servicePaymentHistory.length,
      message: `Service charge paid for ${monthsDurationInt} month(s)`
    });
    
  } catch (error) {
    console.error('❌ Error verifying service charge payment:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================
// CAPACITY INCREASE ROUTES (PG BEDS)
// ========================================

// CREATE CAPACITY INCREASE ORDER
router.post('/create-capacity-increase-order', async (req, res) => {
  try {
    const { propertyId, ownerId, additionalCharge, newMonthlyCharge, couponCode } = req.body;
    
    console.log('💰 ==================== CAPACITY INCREASE ORDER ====================');
    console.log('Property ID:', propertyId);
    console.log('Owner ID:', ownerId);
    console.log('Additional Charge:', additionalCharge);
    console.log('New Monthly Charge:', newMonthlyCharge);
    console.log('Coupon Code:', couponCode || 'None');
    
    if (!propertyId || !ownerId || !additionalCharge) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: propertyId, ownerId, additionalCharge'
      });
    }
    
    // Apply coupon if provided
    const couponResult = validateAndApplyCoupon(additionalCharge, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({
        success: false,
        message: couponResult.error,
      });
    }

    let finalAmount = couponResult.finalAmount;
    
    if (couponResult.couponCode) {
      console.log('🎟️ Coupon Applied:', couponResult.couponCode);
      console.log('💰 Final Amount: ₹' + finalAmount);
    }
    
    const amountInPaise = Math.round(finalAmount * 100);
    
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `capacity_${Date.now()}`.substring(0, 40),
      notes: {
        type: 'capacity_increase',
        propertyId: propertyId,
        ownerId: ownerId,
        additionalCharge: additionalCharge,
        newMonthlyCharge: newMonthlyCharge,
        couponCode: couponResult.couponCode || 'none',
        couponDiscount: couponResult.discount || 0,
        finalAmount: finalAmount,
      },
    });
    
    console.log('✅ Order created:', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
      additionalCharge: additionalCharge,
      couponDiscount: couponResult.discount || 0,
      couponPercent: couponResult.discountPercent || 0,
      couponCode: couponResult.couponCode,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating capacity increase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message,
    });
  }
});

// VERIFY CAPACITY INCREASE PAYMENT
router.post('/verify-capacity-increase-payment', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      propertyId,
      additionalCharge,
      newMonthlyCharge
    } = req.body;
    
    console.log('🔍 ==================== VERIFY CAPACITY INCREASE ====================');
    console.log('Order ID:', razorpay_order_id);
    console.log('Payment ID:', razorpay_payment_id);
    console.log('Property ID:', propertyId);
    console.log('Additional Charge:', additionalCharge);
    console.log('New Monthly Charge:', newMonthlyCharge);
    
    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature !== expectedSign) {
      console.error('❌ Invalid payment signature');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid signature' 
      });
    }
    
    console.log('✅ Payment signature verified');
    
    // Fetch payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    console.log('💳 Payment details:', {
      amount: payment.amount,
      status: payment.status,
      method: payment.method
    });
    
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      console.error('❌ Payment not successful. Status:', payment.status);
      return res.status(400).json({
        success: false,
        message: 'Payment not completed. Status: ' + payment.status
      });
    }
    
    // Update property with new monthly charge
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    console.log('📋 Property found:', property.title);
    console.log('📊 Old monthly charge:', property.monthlyServiceCharge);
    console.log('📊 New monthly charge:', newMonthlyCharge);
    
    // Update the monthly service charge
    property.monthlyServiceCharge = newMonthlyCharge;
    await property.save();
    
    console.log('✅ Property monthly charge updated');
    console.log('🔍 ==================== VERIFY SUCCESS ====================\n');
    
    res.json({ 
      success: true, 
      paymentId: razorpay_payment_id,
      verified: true,
      newMonthlyCharge: newMonthlyCharge,
      message: 'Capacity increase payment verified and property updated'
    });
    
  } catch (error) {
    console.error('❌ Error verifying capacity increase payment:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================
// BOOKING ROUTES
// ========================================

router.post('/create-booking-order', async (req, res) => {
  try {
    const { 
      propertyId, 
      ownerId, 
      monthlyRent, 
      securityDeposit,
      propertyTitle,
      tenantEmail 
    } = req.body;
    
    console.log('💰 ==================== BOOKING ORDER ====================');
    console.log('Property ID:', propertyId);
    console.log('Monthly Rent:', monthlyRent);
    console.log('Security Deposit:', securityDeposit);
    
    const baseAmount = monthlyRent + securityDeposit;
    const convenienceFee = Math.round((baseAmount * 2.7) / 100);
    const finalAmount = baseAmount + convenienceFee;
    
    console.log('💵 Calculation:');
    console.log('   Base Amount: ₹' + baseAmount);
    console.log('   Convenience Fee (2.7%): +₹' + convenienceFee);
    console.log('   Final Amount: ₹' + finalAmount);
    
    const amountInPaise = Math.round(finalAmount * 100);
    
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `booking_${Date.now()}`.substring(0, 40),
      notes: {
        type: 'initial_booking',
        propertyId: propertyId,
        ownerId: ownerId,
        tenantEmail: tenantEmail,
        monthlyRent: monthlyRent,
        securityDeposit: securityDeposit,
        convenienceFee: convenienceFee,
        finalAmount: finalAmount,
      },
    });
    
    console.log('✅ Booking order created:', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating booking order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message,
    });
  }
});

// ========================================
// BANK DETAILS ROUTES - FIXED VERSION
// ========================================

// ⭐ FIX: Save bank details with correct field name "ifsc"
router.post('/bank-details', async (req, res) => {
  try {
    const { accountHolderName, accountNumber, ifscCode, bankName, branchName, ownerId, email, phone } = req.body;
    
    console.log('🏦 ==================== SAVING BANK DETAILS ====================');
    console.log('Owner ID:', ownerId);
    console.log('IFSC Code received:', ifscCode);
    
    if (!phone || !email || !accountHolderName || !accountNumber || !ifscCode || !ownerId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    const owner = await User.findById(ownerId);
    if (!owner) {
      return res.status(404).json({ success: false, message: 'Owner not found' });
    }
    
    const ifscUpper = ifscCode.toUpperCase();
    console.log('✅ IFSC Code (uppercase):', ifscUpper);
    
    if (ROUTE_API_AVAILABLE) {
      const contact = await razorpay.contacts.create({
        name: accountHolderName,
        email: email,
        contact: phone,
        type: 'vendor',
        reference_id: owner._id.toString(),
      });
      
      const fundAccount = await razorpay.fundAccount.create({
        contact_id: contact.id,
        account_type: 'bank_account',
        bank_account: {
          name: accountHolderName,
          ifsc: ifscUpper, // Razorpay uses "ifsc"
          account_number: accountNumber,
        },
      });
      
      // ⭐ FIX: Save as "ifsc" to match the User model schema
      await User.findByIdAndUpdate(owner._id, {
        $set: {
          razorpayContactId: contact.id,
          razorpayFundAccountId: fundAccount.id,
          'personalDetails.phone': phone,
          email: email,
          bankDetails: {
            accountHolderName,
            accountNumber,
            ifsc: ifscUpper, // ⭐ Changed from "ifscCode" to "ifsc"
            bankName: bankName || '',
            branchName: branchName || '',
            verifiedAt: new Date(),
            status: 'active',
          },
        },
      });
      
      console.log('✅ Bank details saved with IFSC:', ifscUpper);
      console.log('🏦 ==================== SAVE SUCCESS ====================\n');
      
      return res.status(200).json({
        success: true,
        message: 'Bank details saved successfully',
        data: { 
          contactId: contact.id, 
          fundAccountId: fundAccount.id, 
          autoTransferEnabled: true,
          ifscCode: ifscUpper // Return as ifscCode for frontend compatibility
        },
      });
    }
    
    // ⭐ FIX: Save as "ifsc" even without Razorpay Route API
    await User.findByIdAndUpdate(owner._id, {
      $set: {
        'personalDetails.phone': phone,
        email: email,
        bankDetails: {
          accountHolderName,
          accountNumber,
          ifsc: ifscUpper, // ⭐ Changed from "ifscCode" to "ifsc"
          bankName: bankName || '',
          branchName: branchName || '',
          verifiedAt: new Date(),
          status: 'pending_razorpay',
        },
      },
    });
    
    console.log('✅ Bank details saved with IFSC:', ifscUpper);
    console.log('🏦 ==================== SAVE SUCCESS ====================\n');
    
    return res.status(200).json({
      success: true,
      message: 'Bank details saved successfully',
      data: { 
        autoTransferEnabled: false,
        ifscCode: ifscUpper // Return as ifscCode for frontend compatibility
      },
    });
    
  } catch (error) {
    console.error('❌ Error in /bank-details:', error);
    return res.status(500).json({ success: false, message: 'Failed to save bank details', error: error.message });
  }
});

// ⭐ FIX: Retrieve bank details with correct field name "ifsc"
router.get('/bank-details/:ownerId', async (req, res) => {
  try {
    console.log('🏦 ==================== RETRIEVING BANK DETAILS ====================');
    console.log('Owner ID:', req.params.ownerId);
    
    const owner = await User.findById(req.params.ownerId);
    
    if (!owner || !owner.bankDetails) {
      console.log('⚠️ No bank details found');
      return res.status(404).json({ success: false, message: 'No bank details found' });
    }
    
    console.log('📋 Bank Details Object:', owner.bankDetails);
    console.log('🔑 IFSC field value:', owner.bankDetails.ifsc); // ⭐ Using "ifsc"
    
    const maskedAccountNumber = owner.bankDetails.accountNumber
      ? `****${owner.bankDetails.accountNumber.slice(-4)}`
      : null;
    
    // ⭐ FIX: Read from "ifsc" field, return as "ifscCode" for frontend
    const responseData = {
      accountHolderName: owner.bankDetails.accountHolderName,
      accountNumber: maskedAccountNumber,
      ifscCode: owner.bankDetails.ifsc, // ⭐ Read "ifsc", return as "ifscCode"
      bankName: owner.bankDetails.bankName,
      branchName: owner.bankDetails.branchName,
      verifiedAt: owner.bankDetails.verifiedAt,
      status: owner.bankDetails.status || 'active',
      hasRazorpayLinked: !!(owner.razorpayContactId && owner.razorpayFundAccountId),
      autoTransferEnabled: !!(owner.razorpayFundAccountId),
    };
    
    console.log('✅ Returning IFSC Code:', responseData.ifscCode);
    console.log('🏦 ==================== RETRIEVE SUCCESS ====================\n');
    
    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ Error retrieving bank details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bank details', error: error.message });
  }
});
// ========================================
// OTHER UTILITY ROUTES
// ========================================

router.post('/create-order', async (req, res) => {
  try {
    const { propertyType, beds, bhk, propertyTitle, couponCode } = req.body;
    const originalAmount = calculateServiceCharge(propertyType, beds, bhk);
    const couponResult = validateAndApplyCoupon(originalAmount, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({ success: false, message: couponResult.error });
    }
    
    const order = await razorpay.orders.create({
      amount: Math.round(couponResult.finalAmount * 100),
      currency: 'INR',
      receipt: `owner_svc_${Date.now()}`,
      notes: {
        type: 'owner_service_charge',
        propertyType, beds, bhk, propertyTitle,
        originalAmount, couponCode: couponResult.couponCode || 'none',
        finalAmount: couponResult.finalAmount,
      },
    });
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: couponResult.finalAmount,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create payment order', error: error.message });
  }
});

router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(sign.toString()).digest('hex');
    
    if (razorpay_signature === expectedSign) {
      res.json({ success: true, paymentId: razorpay_payment_id, verified: true });
    } else {
      res.status(400).json({ success: false, message: 'Invalid signature' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/test-razorpay', async (req, res) => {
  try {
    const testOrder = await razorpay.orders.create({
      amount: 100,
      currency: 'INR',
      receipt: 'test_' + Date.now(),
    });
    res.json({
      success: true,
      message: 'Razorpay is configured correctly!',
      testOrderId: testOrder.id,
      routeApiAvailable: ROUTE_API_AVAILABLE,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Razorpay test failed', error: error.message });
  }
});

router.get('/debug/all-bookings', async (req, res) => {
  try {
    const allBookings = await Booking.find({}).limit(10);
    
    const bookingSummary = allBookings.map(booking => ({
      _id: booking._id,
      tenantEmail: booking.tenantEmail,
      tenantName: booking.tenantName,
      propertyTitle: booking.propertyTitle,
      status: booking.status,
      monthlyRent: booking.monthlyRent,
      rentDueDate: booking.rentDueDate,
      totalPaymentsInHistory: booking.rentPaymentHistory?.length || 0,
      paymentHistory: booking.rentPaymentHistory || []
    }));
    
    res.json({
      success: true,
      totalBookings: allBookings.length,
      bookings: bookingSummary
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
