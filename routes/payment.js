// ========================================
// COMPLETE BACKEND PAYMENT ROUTES - FINAL VERSION
// File: routes/payment.js
// ✅ Supports Owner Service Charge & Tenant Rent Payment with Auto-Transfer
// ✅ Full coupon support (RENTIFY25, RENTIFY50, RENTIFY100)
// ✅ Monthly subscription system (1/3/6/12 months)
// ✅ Fixed receipt ID length (max 40 chars)
// ✅ Property model loaded at top (single require)
// ========================================

const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/user');
const Property = require('../models/Property'); // ⭐ FIXED: Loaded once at top
const Booking = require('../models/Booking'); // ⭐ ADDED: For tenant rent payments

// ========================================
// RAZORPAY INITIALIZATION
// ========================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

console.log('🔑 Razorpay Configuration Check:');
console.log('  - Key ID exists:', !!process.env.RAZORPAY_KEY_ID);
console.log('  - Key Secret exists:', !!process.env.RAZORPAY_KEY_SECRET);
console.log('  - Razorpay instance created:', !!razorpay);
console.log('  - Contacts API available:', typeof razorpay.contacts !== 'undefined');
console.log('  - Fund Account API available:', typeof razorpay.fundAccount !== 'undefined');

const ROUTE_API_AVAILABLE = typeof razorpay.contacts !== 'undefined' && typeof razorpay.fundAccount !== 'undefined';

if (!ROUTE_API_AVAILABLE) {
  console.warn('\n⚠️  ========================================');
  console.warn('   ROUTE API NOT AVAILABLE');
  console.warn('   ========================================');
  console.warn('   Bank details will be saved to database only.');
  console.warn('   Automatic transfers will not work until Route API is enabled.');
  console.warn('   Contact Razorpay support to enable Route API.');
  console.warn('   ========================================\n');
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function calculateServiceCharge(propertyType, beds, bhk) {
  const RATE_PER_UNIT = 18;
  let charge = RATE_PER_UNIT;
  
  if (propertyType === 'PG') {
    charge = (parseInt(beds) || 1) * RATE_PER_UNIT;
  } else if (propertyType === 'Flat' || propertyType === 'Apartment') {
    // Extract number from "3 BHK" format
    if (bhk) {
      const match = bhk.match(/(\d+)/);
      if (match) {
        charge = parseInt(match[1]) * RATE_PER_UNIT;
      }
    }
  }
  
  return Math.max(charge, RATE_PER_UNIT);
}

// ✅ Coupon validation and calculation
const VALID_COUPONS = {
  'RENTIFY25': 25,   // 25% off
  'RENTIFY50': 50,   // 50% off
  'RENTIFY100': 100, // 100% off (charges ₹1)
};

function validateAndApplyCoupon(originalAmount, couponCode) {
  if (!couponCode) {
    return {
      valid: true,
      finalAmount: originalAmount,
      discount: 0,
      discountPercent: 0,
    };
  }

  const couponUpper = couponCode.toUpperCase();
  
  if (!VALID_COUPONS[couponUpper]) {
    return {
      valid: false,
      error: 'Invalid coupon code',
    };
  }

  const discountPercent = VALID_COUPONS[couponUpper];
  const discountAmount = Math.round((originalAmount * discountPercent) / 100);
  let finalAmount = originalAmount - discountAmount;

  // Special handling for 100% coupon - charge ₹1 instead of ₹0
  if (discountPercent === 100 && finalAmount === 0) {
    finalAmount = 1;
  }

  return {
    valid: true,
    finalAmount,
    discount: discountAmount,
    discountPercent,
    couponCode: couponUpper,
  };
}

// ⭐ Subscription pricing structure
const SERVICE_CHARGE_PRICING = {
  1: { months: 1, price: 499, discount: 0 },
  3: { months: 3, price: 1299, discount: 13 },
  6: { months: 6, price: 2399, discount: 20 },
  12: { months: 12, price: 4499, discount: 25 }
};

// ========================================
// BANK DETAILS
// ========================================
router.post('/bank-details', async (req, res) => {
  try {
    const {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      ownerId,
      email,
      phone,
    } = req.body;

    console.log('🏦 ==================== BANK DETAILS REQUEST ====================');
    console.log('Account Holder:', accountHolderName);
    console.log('Owner ID:', ownerId);
    console.log('Email:', email);
    console.log('Phone:', phone);
    console.log('Route API Available:', ROUTE_API_AVAILABLE);

    // Validation
    if (!phone || phone.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Must be 10 digits starting with 6-9',
      });
    }

    if (!email || email.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!accountHolderName || !accountNumber || !ifscCode || !ownerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscCode.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IFSC code format. Must be 11 characters (e.g., SBIN0001234)',
      });
    }

    const owner = await User.findById(ownerId);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found',
      });
    }

    console.log('✅ Owner found:', owner._id);

    // WITH ROUTE API
    if (ROUTE_API_AVAILABLE) {
      console.log('📞 Creating Razorpay contact...');
      
      let contact;
      try {
        contact = await razorpay.contacts.create({
          name: accountHolderName,
          email: email,
          contact: phone,
          type: 'vendor',
          reference_id: owner._id.toString(),
          notes: {
            owner_id: owner._id.toString(),
            account_holder: accountHolderName,
          },
        });
        
        console.log('✅ Contact created:', contact.id);
      } catch (error) {
        console.error('❌ Error creating Razorpay contact:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to create Razorpay contact',
          error: error.message,
          details: error.error?.description || error.message,
        });
      }

      console.log('🏦 Creating fund account...');
      
      let fundAccount;
      try {
        fundAccount = await razorpay.fundAccount.create({
          contact_id: contact.id,
          account_type: 'bank_account',
          bank_account: {
            name: accountHolderName,
            ifsc: ifscCode.toUpperCase(),
            account_number: accountNumber,
          },
        });
        
        console.log('✅ Fund account created:', fundAccount.id);
      } catch (error) {
        console.error('❌ Error creating fund account:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to create fund account',
          error: error.message,
          details: error.error?.description || error.message,
        });
      }

      await User.findByIdAndUpdate(owner._id, {
        $set: {
          razorpayContactId: contact.id,
          razorpayFundAccountId: fundAccount.id,
          'personalDetails.phone': phone,
          email: email,
          bankDetails: {
            accountHolderName,
            accountNumber,
            ifscCode: ifscCode.toUpperCase(),
            bankName: bankName || '',
            branchName: branchName || '',
            verifiedAt: new Date(),
            status: 'active',
          },
        },
      });

      console.log('✅ Bank details saved with Razorpay integration');
      console.log('🏦 ==================== SUCCESS (WITH ROUTE API) ====================\n');

      return res.status(200).json({
        success: true,
        message: 'Bank details saved successfully. Automatic rent transfers are enabled.',
        data: {
          contactId: contact.id,
          fundAccountId: fundAccount.id,
          autoTransferEnabled: true,
        },
      });
    }

    // WITHOUT ROUTE API
    console.log('💾 Saving bank details to database (Route API not available)...');
    
    await User.findByIdAndUpdate(owner._id, {
      $set: {
        'personalDetails.phone': phone,
        email: email,
        bankDetails: {
          accountHolderName,
          accountNumber,
          ifscCode: ifscCode.toUpperCase(),
          bankName: bankName || '',
          branchName: branchName || '',
          verifiedAt: new Date(),
          status: 'pending_razorpay',
        },
      },
    });

    console.log('✅ Bank details saved (database only)');
    console.log('🏦 ==================== SUCCESS (DATABASE ONLY) ====================\n');

    return res.status(200).json({
      success: true,
      message: 'Bank details saved successfully.',
      data: {
        ownerId: owner._id,
        accountHolderName,
        ifscCode: ifscCode.toUpperCase(),
        savedAt: new Date(),
        autoTransferEnabled: false,
      },
      note: 'Automatic transfers will be enabled once Route API is configured.',
    });

  } catch (error) {
    console.error('❌ Error in /bank-details:', error);
    console.error('Stack trace:', error.stack);
    return res.status(500).json({
      success: false,
      message: 'Failed to save bank details',
      error: error.message,
    });
  }
});

// ========================================
// GET BANK DETAILS
// ========================================
router.get('/bank-details/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    const owner = await User.findById(ownerId);
    
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found',
      });
    }

    if (!owner.bankDetails) {
      return res.status(404).json({
        success: false,
        message: 'No bank details found',
        hasBankDetails: false,
      });
    }

    const maskedAccountNumber = owner.bankDetails.accountNumber
      ? `****${owner.bankDetails.accountNumber.slice(-4)}`
      : null;

    res.json({
      success: true,
      data: {
        accountHolderName: owner.bankDetails.accountHolderName,
        accountNumber: maskedAccountNumber,
        ifscCode: owner.bankDetails.ifscCode,
        bankName: owner.bankDetails.bankName,
        branchName: owner.bankDetails.branchName,
        verifiedAt: owner.bankDetails.verifiedAt,
        status: owner.bankDetails.status || 'active',
        hasRazorpayLinked: !!(owner.razorpayContactId && owner.razorpayFundAccountId),
        autoTransferEnabled: !!(owner.razorpayFundAccountId),
      },
    });

  } catch (error) {
    console.error('❌ Error fetching bank details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bank details',
      error: error.message,
    });
  }
});

// ========================================
// CREATE OWNER SERVICE CHARGE ORDER - WITH COUPON SUPPORT
// For initial property upload payment
// ========================================
router.post('/create-order', async (req, res) => {
  try {
    const { propertyType, beds, bhk, propertyTitle, couponCode } = req.body;
    
    console.log('💰 ==================== CREATE ORDER ====================');
    console.log('Property Type:', propertyType);
    console.log('Beds:', beds);
    console.log('BHK:', bhk);
    console.log('Coupon Code:', couponCode || 'None');
    
    // Calculate original amount
    const originalAmount = calculateServiceCharge(propertyType, beds, bhk);
    console.log('Original Amount: ₹' + originalAmount);
    
    // Apply coupon if provided
    const couponResult = validateAndApplyCoupon(originalAmount, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({
        success: false,
        message: couponResult.error,
      });
    }

    const finalAmount = couponResult.finalAmount;
    console.log('Coupon Applied:', couponResult.couponCode || 'None');
    console.log('Discount:', couponResult.discountPercent + '%');
    console.log('Final Amount: ₹' + finalAmount);
    
    const amountInPaise = Math.round(finalAmount * 100);
    
    if (amountInPaise < 100) {
      return res.status(400).json({
        success: false,
        message: `Amount too low: ₹${finalAmount}. Minimum ₹1 required.`,
      });
    }
    
    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `owner_svc_${Date.now()}`,
      notes: {
        type: 'owner_service_charge',
        propertyType: propertyType || 'Unknown',
        beds: beds || 0,
        bhk: bhk || '0',
        propertyTitle: propertyTitle || 'Property',
        originalAmount: originalAmount,
        couponCode: couponResult.couponCode || 'none',
        discountPercent: couponResult.discountPercent || 0,
        discountAmount: couponResult.discount || 0,
        finalAmount: finalAmount,
      },
    });
    
    console.log('✅ Order created:', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
      originalAmount: originalAmount,
      discount: couponResult.discount,
      discountPercent: couponResult.discountPercent,
      couponCode: couponResult.couponCode,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message,
    });
  }
});

// ========================================
// VERIFY PAYMENT SIGNATURE - WITH COUPON TRACKING
// ========================================
router.post('/verify-payment', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      propertyData 
    } = req.body;
    
    console.log('🔍 ==================== VERIFY PAYMENT ====================');
    console.log('Order ID:', razorpay_order_id);
    console.log('Payment ID:', razorpay_payment_id);
    console.log('Property Data:', propertyData);
    
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature === expectedSign) {
      console.log('✅ Payment signature verified');
      
      // Log coupon usage if present
      if (propertyData?.couponCode) {
        console.log('🎟️ Coupon used:', propertyData.couponCode);
        console.log('💰 Original Amount: ₹' + propertyData.originalAmount);
        console.log('💰 Final Amount: ₹' + propertyData.amount);
        console.log('💸 Discount: ' + propertyData.discountPercent + '%');
      }
      
      console.log('🔍 ==================== VERIFY SUCCESS ====================\n');
      
      res.json({ 
        success: true, 
        paymentId: razorpay_payment_id,
        verified: true,
      });
    } else {
      console.error('❌ Invalid payment signature');
      res.status(400).json({ 
        success: false, 
        message: 'Invalid signature' 
      });
    }
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================
// CREATE TENANT RENT ORDER WITH AUTO-TRANSFER
// ⭐ NEW: Includes 2.7% convenience fee
// ========================================
router.post('/create-tenant-order', async (req, res) => {
  try {
    const {
      propertyId,
      ownerId,
      tenantName,
      tenantEmail,
      tenantPhone,
      monthlyRent,
      securityDeposit,
      convenienceFee, // ⭐ NEW
      propertyTitle,
    } = req.body;

    console.log('💰 ==================== TENANT ORDER ====================');
    console.log('Property ID:', propertyId);
    console.log('Owner ID:', ownerId);
    console.log('Monthly Rent: ₹' + monthlyRent);
    console.log('Security Deposit: ₹' + securityDeposit);
    console.log('Convenience Fee (2.7%): ₹' + convenienceFee); // ⭐ NEW
    console.log('Total: ₹' + (parseInt(monthlyRent) + parseInt(securityDeposit) + parseInt(convenienceFee || 0)));

    if (!propertyId || !ownerId || !monthlyRent || !securityDeposit) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const baseAmount = parseInt(monthlyRent) + parseInt(securityDeposit);
    const feeAmount = parseInt(convenienceFee || 0);
    const totalAmount = baseAmount + feeAmount;

    if (totalAmount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be at least ₹1',
      });
    }

    const owner = await User.findById(ownerId);
    
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Property owner not found',
      });
    }

    const amountInPaise = totalAmount * 100;
    
    // ⭐ IMPORTANT: Only transfer base amount to owner (not including convenience fee)
    const ownerTransferAmount = baseAmount * 100;
    
    if (ROUTE_API_AVAILABLE && owner.razorpayFundAccountId) {
      const orderOptions = {
        amount: amountInPaise, // Total amount (including fee)
        currency: 'INR',
        receipt: `tenant_rent_${Date.now()}`,
        notes: {
          type: 'tenant_rent_payment',
          propertyId,
          ownerId,
          propertyTitle: propertyTitle || 'Property',
          monthlyRent,
          securityDeposit,
          convenienceFee: feeAmount, // ⭐ Store fee
          baseAmount: baseAmount,
          totalAmount: totalAmount,
        },
        transfers: [
          {
            account: owner.razorpayFundAccountId,
            amount: ownerTransferAmount, // ⭐ Only base amount to owner
            currency: 'INR',
            notes: { 
              propertyId, 
              rentPayment: true,
              excludesConvenienceFee: true 
            },
            on_hold: 0,
          }
        ]
      };

      const order = await razorpay.orders.create(orderOptions);
      console.log('✅ Tenant order created with auto-transfer:', order.id);
      console.log('💸 Owner receives: ₹' + baseAmount);
      console.log('💰 Platform keeps: ₹' + feeAmount);

      return res.status(200).json({
        success: true,
        orderId: order.id,
        amount: totalAmount,
        baseAmount: baseAmount,
        convenienceFee: feeAmount,
        currency: 'INR',
        key: process.env.RAZORPAY_KEY_ID,
        autoTransferEnabled: true,
      });
    }

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `tenant_rent_${Date.now()}`,
      notes: {
        type: 'tenant_rent_payment',
        propertyId,
        ownerId,
        propertyTitle: propertyTitle || 'Property',
        monthlyRent,
        securityDeposit,
        convenienceFee: feeAmount, // ⭐ Store fee
        baseAmount: baseAmount,
        totalAmount: totalAmount,
      },
    });

    console.log('✅ Tenant order created (manual payout):', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: totalAmount,
      baseAmount: baseAmount,
      convenienceFee: feeAmount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
      autoTransferEnabled: false,
      note: 'Manual payout will be processed by admin',
    });

  } catch (error) {
    console.error('❌ Error creating tenant order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message,
    });
  }
});

// ========================================
// CREATE SERVICE CHARGE SUBSCRIPTION ORDER - WITH COUPON SUPPORT
// For paying monthly service fees (1/3/6/12 months)
// ========================================
router.post('/create-service-charge-order', async (req, res) => {
  try {
    const { propertyId, monthsDuration, ownerId, couponCode } = req.body; // ⭐ Added couponCode
    
    console.log('💰 ==================== SERVICE CHARGE ORDER ====================');
    console.log('Property ID:', propertyId);
    console.log('Owner ID:', ownerId);
    console.log('Months Duration:', monthsDuration);
    console.log('Coupon Code:', couponCode || 'None'); // ⭐ Log coupon
    
    // Validation
    if (!propertyId || !ownerId || !monthsDuration) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: propertyId, ownerId, monthsDuration'
      });
    }
    
    if (![1, 3, 6, 12].includes(parseInt(monthsDuration))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid duration. Must be 1, 3, 6, or 12 months'
      });
    }
    
    // Get pricing
    const pricing = SERVICE_CHARGE_PRICING[monthsDuration];
    const originalAmount = pricing.price;
    
    console.log('💵 Original Amount: ₹' + originalAmount);
    console.log('📅 Duration: ' + pricing.months + ' months');
    console.log('💸 Duration Discount: ' + pricing.discount + '%');
    
    // ⭐ Apply coupon if provided
    const couponResult = validateAndApplyCoupon(originalAmount, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({
        success: false,
        message: couponResult.error,
      });
    }

    const finalAmount = couponResult.finalAmount;
    console.log('🎟️ Coupon Applied:', couponResult.couponCode || 'None');
    console.log('💸 Coupon Discount:', couponResult.discountPercent + '%');
    console.log('💰 Final Amount: ₹' + finalAmount);
    
    // Check if property exists
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    if (property.ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You do not own this property'
      });
    }
    
    // Create Razorpay order with final amount
    const amountInPaise = Math.round(finalAmount * 100); // ⭐ Use finalAmount after coupon
    
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `svc_${Date.now()}`,
      notes: {
        type: 'service_charge_subscription',
        propertyId: propertyId,
        ownerId: ownerId,
        propertyTitle: property.title,
        monthsDuration: pricing.months,
        durationDiscount: pricing.discount,
        originalAmount: originalAmount, // ⭐ Store original
        couponCode: couponResult.couponCode || 'none', // ⭐ Store coupon
        couponDiscount: couponResult.discountPercent || 0, // ⭐ Store coupon discount
        finalAmount: finalAmount, // ⭐ Store final amount
        pricePerMonth: Math.round(finalAmount / pricing.months),
      },
    });
    
    console.log('✅ Order created:', order.id);
    console.log('💰 ==================== ORDER SUCCESS ====================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount, // ⭐ Return final amount
      originalAmount: originalAmount, // ⭐ Return original
      couponDiscount: couponResult.discount, // ⭐ Return discount amount
      couponPercent: couponResult.discountPercent, // ⭐ Return discount percent
      couponCode: couponResult.couponCode, // ⭐ Return coupon code
      monthsDuration: pricing.months,
      durationDiscount: pricing.discount,
      pricePerMonth: Math.round(finalAmount / pricing.months),
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

// ========================================
// VERIFY SERVICE CHARGE PAYMENT & UPDATE PROPERTY
// ========================================
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
    
    // Get property
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    console.log('📋 Property found:', property.title);
    console.log('📅 Current due date:', property.serviceDueDate);
    
    // Get pricing
    const monthsDurationInt = parseInt(monthsDuration);
    const pricing = SERVICE_CHARGE_PRICING[monthsDurationInt];
    
    if (!pricing) {
      console.error('❌ Invalid months duration:', monthsDuration);
      return res.status(400).json({
        success: false,
        message: 'Invalid months duration: ' + monthsDuration
      });
    }
    
    console.log('💵 Pricing details:', pricing);
    
    // Record payment and extend service date
    const paymentData = {
      amount: Number(pricing.price),
      monthsPaid: Number(pricing.months),
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    };
    
    console.log('💾 Recording payment with data:', JSON.stringify(paymentData, null, 2));
    
    try {
      await property.recordPayment(paymentData);
      console.log('✅ Property service extended by ' + pricing.months + ' months');
      console.log('📅 New due date:', property.serviceDueDate);
    } catch (saveError) {
      console.error('❌ Error saving payment:', saveError);
      console.error('Payment data was:', paymentData);
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
      serviceStatus: property.serviceStatus,
      message: `Service extended for ${pricing.months} month(s)`
    });
    
  } catch (error) {
    console.error('❌ Error verifying service charge payment:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================
// GET PROPERTY SERVICE STATUS
// ========================================
router.get('/service-status/:propertyId', async (req, res) => {
  try {
    const { propertyId } = req.params;
    
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    // Calculate days until/since due
    const now = new Date();
    const dueDate = property.serviceDueDate;
    const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
    
    // Get status
    const status = property.getPaymentStatus();
    
    // Calculate monthly charge
    const monthlyCharge = property.calculateServiceCharge();
    
    res.json({
      success: true,
      data: {
        propertyId: property._id,
        propertyTitle: property.title,
        serviceStatus: status,
        isActive: property.isActive,
        serviceDueDate: dueDate,
        daysUntilDue: daysUntilDue,
        isOverdue: daysUntilDue < 0,
        inGracePeriod: daysUntilDue < 0 && daysUntilDue >= -10,
        gracePeriodDaysLeft: daysUntilDue < 0 ? Math.max(0, 10 + daysUntilDue) : null,
        lastPayment: property.lastServicePayment,
        monthlyCharge: monthlyCharge,
        suspendedAt: property.suspendedAt,
        suspensionReason: property.suspensionReason,
        paymentHistory: property.servicePaymentHistory.slice(-5).reverse(),
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching service status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service status',
      error: error.message
    });
  }
});

// ========================================
// GET ALL PROPERTIES SERVICE STATUS FOR OWNER
// ========================================
router.get('/owner-service-status/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    const properties = await Property.find({ ownerId });
    
    const propertiesWithStatus = properties.map(property => {
      const now = new Date();
      const dueDate = property.serviceDueDate;
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const status = property.getPaymentStatus();
      
      return {
        propertyId: property._id,
        propertyTitle: property.title,
        serviceStatus: status,
        isActive: property.isActive,
        serviceDueDate: dueDate,
        daysUntilDue: daysUntilDue,
        isOverdue: daysUntilDue < 0,
        inGracePeriod: daysUntilDue < 0 && daysUntilDue >= -10,
        gracePeriodDaysLeft: daysUntilDue < 0 ? Math.max(0, 10 + daysUntilDue) : null,
        monthlyCharge: property.calculateServiceCharge(),
        type: property.type,
        beds: property.beds,
        bhk: property.bhk,
      };
    });
    
    // Summary
    const summary = {
      totalProperties: properties.length,
      activeProperties: propertiesWithStatus.filter(p => p.serviceStatus === 'active').length,
      dueProperties: propertiesWithStatus.filter(p => p.serviceStatus === 'due').length,
      overdueProperties: propertiesWithStatus.filter(p => p.serviceStatus === 'overdue').length,
      suspendedProperties: propertiesWithStatus.filter(p => p.serviceStatus === 'suspended').length,
    };
    
    res.json({
      success: true,
      summary,
      properties: propertiesWithStatus
    });
    
  } catch (error) {
    console.error('❌ Error fetching owner service status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service status',
      error: error.message
    });
  }
});

// ========================================
// GET PRICING OPTIONS
// ========================================
router.get('/service-charge-pricing', (req, res) => {
  res.json({
    success: true,
    pricing: SERVICE_CHARGE_PRICING
  });
});

// ========================================
// TEST RAZORPAY CONNECTION
// ========================================
router.get('/test-razorpay', async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay credentials not configured',
      });
    }
    
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
      couponsAvailable: Object.keys(VALID_COUPONS),
      apis: {
        orders: typeof razorpay.orders !== 'undefined',
        payments: typeof razorpay.payments !== 'undefined',
        contacts: typeof razorpay.contacts !== 'undefined',
        fundAccount: typeof razorpay.fundAccount !== 'undefined',
      }
    });
  } catch (error) {
    console.error('❌ Razorpay test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Razorpay test failed',
      error: error.message,
    });
  }
});

// ========================================
// GET PAYMENT DETAILS
// ========================================
router.get('/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await razorpay.payments.fetch(paymentId);
    res.status(200).json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error fetching payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details',
      error: error.message,
    });
  }
});

// ========================================
// GET TRANSFER STATUS
// ========================================
router.get('/transfer-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const transfers = await razorpay.payments.fetchTransfers(paymentId);
    res.status(200).json({ success: true, transfers: transfers.items });
  } catch (error) {
    console.error('❌ Error fetching transfers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer status',
      error: error.message,
    });
  }
});

module.exports = router;

// ========================================
// TENANT RENT PAYMENT (MONTHLY)
// Similar to owner service charge but for tenants
// ⭐ Includes 2.7% convenience fee + duration options
// ========================================

// Tenant rent pricing (1/3/6/12 months)
const TENANT_RENT_PRICING = {
  1: { months: 1, discount: 0 },
  3: { months: 3, discount: 5 },  // 5% discount for 3 months
  6: { months: 6, discount: 10 }, // 10% discount for 6 months
  12: { months: 12, discount: 15 } // 15% discount for 12 months
};

router.post('/create-tenant-rent-order', async (req, res) => {
  try {
    const { bookingId, propertyId, monthsDuration, couponCode } = req.body;
    
    console.log('💰 ==================== TENANT RENT ORDER ====================');
    console.log('Booking ID:', bookingId);
    console.log('Property ID:', propertyId);
    console.log('Months Duration:', monthsDuration);
    console.log('Coupon Code:', couponCode || 'None');
    
    // Validation
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
    
    // Get booking
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    // Calculate amount
    const pricing = TENANT_RENT_PRICING[monthsDuration];
    const monthlyRent = booking.monthlyRent;
    const baseAmount = monthlyRent * pricing.months;
    
    // Apply duration discount
    const durationDiscount = Math.round((baseAmount * pricing.discount) / 100);
    const afterDurationDiscount = baseAmount - durationDiscount;
    
    // Add 2.7% convenience fee
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
    
    // ⭐ Apply coupon if provided
    const couponResult = validateAndApplyCoupon(finalAmount, couponCode);
    
    if (!couponResult.valid) {
      return res.status(400).json({
        success: false,
        message: couponResult.error,
      });
    }

    if (couponResult.finalAmount !== finalAmount) {
      console.log('🎟️ Coupon Applied:', couponResult.couponCode);
      console.log('💸 Coupon Discount:', couponResult.discountPercent + '%');
      finalAmount = couponResult.finalAmount;
      console.log('💰 New Final Amount: ₹' + finalAmount);
    }
    
    // Create Razorpay order
    const amountInPaise = Math.round(finalAmount * 100);
    
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rent_${Date.now()}`,
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

// ========================================
// VERIFY TENANT RENT PAYMENT & UPDATE BOOKING
// ========================================
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
    
    // Get booking
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    console.log('📋 Booking found for tenant:', booking.tenantEmail);
    console.log('📅 Current due date:', booking.rentDueDate);
    
    // Get pricing
    const monthsDurationInt = parseInt(monthsDuration);
    const pricing = TENANT_RENT_PRICING[monthsDurationInt];
    
    if (!pricing) {
      console.error('❌ Invalid months duration:', monthsDuration);
      return res.status(400).json({
        success: false,
        message: 'Invalid months duration: ' + monthsDuration
      });
    }
    
    // Calculate amounts
    const baseAmount = booking.monthlyRent * pricing.months;
    const durationDiscount = Math.round((baseAmount * pricing.discount) / 100);
    const afterDiscount = baseAmount - durationDiscount;
    const convenienceFee = Math.round((afterDiscount * 2.7) / 100);
    const totalAmount = afterDiscount + convenienceFee;
    
    // Record payment
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
      console.log('✅ Rent payment recorded, due date extended by ' + pricing.months + ' months');
      console.log('📅 New due date:', booking.rentDueDate);
    } catch (saveError) {
      console.error('❌ Error saving rent payment:', saveError);
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
      message: `Rent paid for ${pricing.months} month(s)`
    });
    
  } catch (error) {
    console.error('❌ Error verifying rent payment:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
