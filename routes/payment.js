// ========================================
// COMPLETE BACKEND PAYMENT ROUTES - WITH COUPON SUPPORT
// File: routes/payment.js
// ✅ Supports Owner Service Charge & Tenant Rent Payment with Auto-Transfer
// ✅ Fixed phone validation (uses req.body.phone)
// ✅ Includes fallback for when Route API is not available
// ✅ NEW: Full coupon support (RENTIFY25, RENTIFY50, RENTIFY100)
// ========================================

const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/user');

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
    charge = (parseInt(bhk) || 1) * RATE_PER_UNIT;
  }
  
  return Math.max(charge, RATE_PER_UNIT);
}

// ✅ NEW: Coupon validation and calculation
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

  // ✅ Special handling for 100% coupon - charge ₹1 instead of ₹0
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
    
    // ✅ Apply coupon if provided
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
      
      // ✅ Log coupon usage if present
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
      propertyTitle,
    } = req.body;

    if (!propertyId || !ownerId || !monthlyRent || !securityDeposit) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const totalAmount = parseInt(monthlyRent) + parseInt(securityDeposit);

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
    
    if (ROUTE_API_AVAILABLE && owner.razorpayFundAccountId) {
      const orderOptions = {
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
        },
        transfers: [
          {
            account: owner.razorpayFundAccountId,
            amount: amountInPaise,
            currency: 'INR',
            notes: { propertyId, rentPayment: true },
            on_hold: 0,
          }
        ]
      };

      const order = await razorpay.orders.create(orderOptions);
      console.log('✅ Tenant order created with auto-transfer:', order.id);

      return res.status(200).json({
        success: true,
        orderId: order.id,
        amount: totalAmount,
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
      },
    });

    console.log('✅ Tenant order created (manual payout):', order.id);

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: totalAmount,
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
