// ========================================
// COMPLETE BACKEND PAYMENT ROUTES - FINAL VERSION
// File: routes/payment.js
// ✅ Supports Owner Service Charge & Tenant Rent Payment with Auto-Transfer
// ✅ Fixed phone validation (uses req.body.phone)
// ✅ Includes fallback for when Route API is not available
// ========================================

const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/user'); // Adjust path as needed

// ========================================
// RAZORPAY INITIALIZATION
// ========================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Verify Razorpay configuration
console.log('🔑 Razorpay Configuration Check:');
console.log('  - Key ID exists:', !!process.env.RAZORPAY_KEY_ID);
console.log('  - Key Secret exists:', !!process.env.RAZORPAY_KEY_SECRET);
console.log('  - Razorpay instance created:', !!razorpay);
console.log('  - Contacts API available:', typeof razorpay.contacts !== 'undefined');
console.log('  - Fund Account API available:', typeof razorpay.fundAccount !== 'undefined');

// Check if Route API is available
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

// ========================================
// BANK DETAILS - Intelligent Route
// Automatically uses Route API if available, otherwise saves to DB only
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

    // ========================================
    // VALIDATION
    // ========================================

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

    // Get owner from database
    const owner = await User.findById(ownerId);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found',
      });
    }

    console.log('✅ Owner found:', owner._id);

    // ========================================
    // ROUTE 1: WITH ROUTE API (Full Razorpay Integration)
    // ========================================
    
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

      // Save to database with Razorpay IDs
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

    // ========================================
    // ROUTE 2: WITHOUT ROUTE API (Database Only)
    // ========================================
    
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
      note: 'Automatic transfers will be enabled once Route API is configured. You can still receive rent payments - payouts will be processed manually.',
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
// UPGRADE TO RAZORPAY (When Route API becomes available)
// ========================================
router.post('/link-bank-to-razorpay/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;

    if (!ROUTE_API_AVAILABLE) {
      return res.status(503).json({
        success: false,
        message: 'Route API not available yet. Contact support.',
        error: 'ROUTE_API_UNAVAILABLE',
      });
    }

    const owner = await User.findById(ownerId);
    
    if (!owner || !owner.bankDetails) {
      return res.status(404).json({
        success: false,
        message: 'Owner or bank details not found',
      });
    }

    if (owner.razorpayContactId && owner.razorpayFundAccountId) {
      return res.json({
        success: true,
        message: 'Already linked to Razorpay',
        data: {
          contactId: owner.razorpayContactId,
          fundAccountId: owner.razorpayFundAccountId,
        },
      });
    }

    console.log('🔗 Linking existing bank details to Razorpay...');

    const contact = await razorpay.contacts.create({
      name: owner.bankDetails.accountHolderName,
      email: owner.email,
      contact: owner.personalDetails?.phone || '9999999999',
      type: 'vendor',
      reference_id: owner._id.toString(),
    });

    const fundAccount = await razorpay.fundAccount.create({
      contact_id: contact.id,
      account_type: 'bank_account',
      bank_account: {
        name: owner.bankDetails.accountHolderName,
        ifsc: owner.bankDetails.ifscCode,
        account_number: owner.bankDetails.accountNumber,
      },
    });

    await User.findByIdAndUpdate(owner._id, {
      $set: {
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        'bankDetails.status': 'active',
      },
    });

    res.json({
      success: true,
      message: 'Bank details linked to Razorpay successfully',
      data: {
        contactId: contact.id,
        fundAccountId: fundAccount.id,
      },
    });

  } catch (error) {
    console.error('❌ Error linking to Razorpay:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link to Razorpay',
      error: error.message,
    });
  }
});

// ========================================
// CREATE OWNER SERVICE CHARGE ORDER
// ========================================
router.post('/create-order', async (req, res) => {
  try {
    const { propertyType, beds, bhk, propertyTitle } = req.body;
    
    const amount = calculateServiceCharge(propertyType, beds, bhk);
    const amountInPaise = Math.round(amount * 100);
    
    if (amountInPaise < 100) {
      return res.status(400).json({
        success: false,
        message: `Amount too low: ₹${amount}. Minimum ₹1 required.`,
      });
    }
    
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
      },
    });
    
    console.log('✅ Service charge order created:', order.id);
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: amount,
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
    
    // If Route API available and owner has fund account, create order with transfer
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

    // Otherwise, create regular order (manual payout required)
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
// VERIFY PAYMENT SIGNATURE
// ========================================
router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature === expectedSign) {
      console.log('✅ Payment verified:', razorpay_payment_id);
      res.json({ success: true, paymentId: razorpay_payment_id });
    } else {
      res.status(400).json({ success: false, message: 'Invalid signature' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
