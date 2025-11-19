// ========================================
// COMPLETE BACKEND PAYMENT ROUTES
// File: routes/payment.js
// Supports both Owner Service Charge & Tenant Rent Payment with Auto-Transfer
// ========================================

const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/user'); // Adjust path as needed

// ✅ Initialize Razorpay - CRITICAL: Must be done before any route
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Verify Razorpay is properly initialized
console.log('🔑 Razorpay Configuration Check:');
console.log('  - Key ID exists:', !!process.env.RAZORPAY_KEY_ID);
console.log('  - Key Secret exists:', !!process.env.RAZORPAY_KEY_SECRET);
console.log('  - Razorpay instance created:', !!razorpay);
console.log('  - Contacts API available:', typeof razorpay.contacts !== 'undefined');
console.log('  - Fund Account API available:', typeof razorpay.fundAccount !== 'undefined');

// ========================================
// HELPER FUNCTIONS
// ========================================

// Calculate service charge for property owners (₹18 per bed/bhk)
function calculateServiceCharge(propertyType, beds, bhk) {
  console.log('💰 Calculating service charge:');
  console.log('  propertyType:', propertyType, typeof propertyType);
  console.log('  beds:', beds, typeof beds);
  console.log('  bhk:', bhk, typeof bhk);
  
  const RATE_PER_UNIT = 18; // ₹18 per bed/bedroom
  
  let charge = RATE_PER_UNIT; // Default minimum
  
  if (propertyType === 'PG') {
    const bedCount = parseInt(beds) || 1;
    charge = bedCount * RATE_PER_UNIT;
    console.log(`  ✅ PG: ${bedCount} beds × ₹${RATE_PER_UNIT} = ₹${charge}`);
  } else if (propertyType === 'Flat' || propertyType === 'Apartment') {
    const bedroomCount = parseInt(bhk) || 1;
    charge = bedroomCount * RATE_PER_UNIT;
    console.log(`  ✅ Flat: ${bedroomCount} BHK × ₹${RATE_PER_UNIT} = ₹${charge}`);
  } else {
    console.log(`  ✅ Default: 1 × ₹${RATE_PER_UNIT} = ₹${charge}`);
  }
  
  if (charge < RATE_PER_UNIT) {
    console.warn(`  ⚠️ Charge too low, using minimum: ${RATE_PER_UNIT}`);
    charge = RATE_PER_UNIT;
  }
  
  return charge;
}

// ========================================
// NEW: SAVE BANK DETAILS (Called from Flutter App)
// This is the route your Flutter app is calling
// ========================================
router.post('/bank-details', async (req, res) => {
  try {
    const {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      ownerId, // You might get this from auth middleware or body
    } = req.body;

    console.log('🏦 Creating linked account for owner:', accountHolderName);
    console.log('📋 Bank Details:', {
      accountHolderName,
      accountNumber: accountNumber ? '****' + accountNumber.slice(-4) : 'N/A',
      ifscCode,
      bankName,
      branchName,
    });

    // Validate required fields
    if (!accountHolderName || !accountNumber || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: accountHolderName, accountNumber, ifscCode',
      });
    }

    // Validate IFSC format
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscCode.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IFSC code format. Must be 11 characters (e.g., SBIN0001234)',
      });
    }

    // Get owner from database
    // TODO: Replace with actual auth middleware to get ownerId
    let owner;
    if (ownerId) {
      owner = await User.findById(ownerId);
    } else {
      // If you have auth middleware, get from req.user
      // owner = await User.findById(req.user.id);
      return res.status(400).json({
        success: false,
        message: 'Owner ID is required. Please login again.',
      });
    }

    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found',
      });
    }

    // Ensure owner has email and phone
    if (!owner.email) {
      return res.status(400).json({
        success: false,
        message: 'Owner email is required. Please update your profile.',
      });
    }

    if (!owner.phone) {
      return res.status(400).json({
        success: false,
        message: 'Owner phone number is required. Please update your profile.',
      });
    }

    console.log('👤 Owner details:', {
      id: owner._id,
      name: owner.name || accountHolderName,
      email: owner.email,
      phone: owner.phone,
    });

    // ===================================================
    // Step 1: Create Razorpay Contact
    // ===================================================
    console.log('📞 Creating Razorpay contact...');
    
    let contact;
    try {
      // Check if razorpay.contacts exists
      if (!razorpay.contacts) {
        throw new Error('Razorpay contacts API not available. Check Razorpay initialization.');
      }

      contact = await razorpay.contacts.create({
        name: accountHolderName,
        email: owner.email,
        contact: owner.phone,
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
      
      if (error.error) {
        return res.status(400).json({
          success: false,
          message: `Razorpay Contact Error: ${error.error.description}`,
          details: error.error,
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to create Razorpay contact: ' + error.message,
      });
    }

    // ===================================================
    // Step 2: Create Fund Account (Bank Account)
    // ===================================================
    console.log('🏦 Creating fund account...');
    
    let fundAccount;
    try {
      // Check if razorpay.fundAccount exists
      if (!razorpay.fundAccount) {
        throw new Error('Razorpay fund account API not available. Check Razorpay initialization.');
      }

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
      
      if (error.error) {
        return res.status(400).json({
          success: false,
          message: `Razorpay Fund Account Error: ${error.error.description}`,
          details: error.error,
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to create fund account: ' + error.message,
      });
    }

    // ===================================================
    // Step 3: Save to Database
    // ===================================================
    console.log('💾 Saving to database...');
    
    await User.findByIdAndUpdate(owner._id, {
      $set: {
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        bankDetails: {
          accountHolderName,
          accountNumber,
          ifscCode: ifscCode.toUpperCase(),
          bankName,
          branchName,
          verifiedAt: new Date(),
        },
      },
    });

    console.log('✅ Owner bank details saved successfully');

    res.status(200).json({
      success: true,
      message: 'Bank details saved successfully',
      data: {
        contactId: contact.id,
        fundAccountId: fundAccount.id,
      },
    });

  } catch (error) {
    console.error('❌ Error in /bank-details route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create linked account',
      error: error.message,
    });
  }
});

// ========================================
// 1. CREATE/UPDATE RAZORPAY LINKED ACCOUNT FOR OWNER
// Call this when owner registers or updates bank details
// ========================================
router.post('/create-linked-account', async (req, res) => {
  try {
    const {
      ownerId,
      email,
      phone,
      name,
      bankAccountNumber,
      ifsc,
      accountHolderName,
    } = req.body;

    console.log('🏦 Creating linked account for owner:', name);

    // Validate required fields
    if (!ownerId || !email || !phone || !name || !bankAccountNumber || !ifsc || !accountHolderName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields for linked account creation',
      });
    }

    // Create contact in Razorpay
    const contact = await razorpay.contacts.create({
      name: accountHolderName,
      email: email,
      contact: phone,
      type: 'vendor',
      reference_id: ownerId,
      notes: {
        ownerId: ownerId,
        ownerName: name,
      }
    });

    console.log('✅ Contact created:', contact.id);

    // Create fund account (bank account) linked to contact
    const fundAccount = await razorpay.fundAccount.create({
      contact_id: contact.id,
      account_type: 'bank_account',
      bank_account: {
        name: accountHolderName,
        ifsc: ifsc,
        account_number: bankAccountNumber,
      }
    });

    console.log('✅ Fund account created:', fundAccount.id);

    // Update user in database with Razorpay IDs
    await User.findByIdAndUpdate(ownerId, {
      $set: {
        'razorpayContactId': contact.id,
        'razorpayFundAccountId': fundAccount.id,
        'bankDetails': {
          accountNumber: bankAccountNumber,
          ifsc: ifsc,
          accountHolderName: accountHolderName,
          verifiedAt: new Date(),
        }
      }
    });

    console.log('✅ Owner updated in database with Razorpay details');

    res.status(200).json({
      success: true,
      message: 'Linked account created successfully',
      contactId: contact.id,
      fundAccountId: fundAccount.id,
    });

  } catch (error) {
    console.error('❌ Error creating linked account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create linked account',
      error: error.message,
    });
  }
});

// ========================================
// 2. CREATE OWNER SERVICE CHARGE ORDER
// For property owners to pay ₹18/bed platform fee
// ========================================
router.post('/create-order', async (req, res) => {
  try {
    const { propertyType, beds, bhk, propertyTitle } = req.body;
    
    console.log('🔵 ========== OWNER SERVICE CHARGE ==========');
    console.log('Property Type:', propertyType);
    console.log('Beds:', beds);
    console.log('BHK:', bhk);
    
    // Calculate service charge
    let amount = calculateServiceCharge(propertyType, beds, bhk);
    
    if (!amount || amount < 1) {
      console.warn('⚠️ Amount too low, setting to minimum ₹1');
      amount = 1;
    }
    
    const amountInPaise = Math.round(amount * 100);
    console.log('💰 Amount in paise:', amountInPaise);
    
    if (amountInPaise < 100) {
      return res.status(400).json({
        success: false,
        message: `Amount too low: ₹${amount}. Minimum ₹1 required.`,
      });
    }
    
    // Create Razorpay order
    const options = {
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
    };
    
    console.log('📤 Creating Razorpay order:', JSON.stringify(options, null, 2));
    
    const order = await razorpay.orders.create(options);
    
    console.log('✅ Order created:', order.id);
    console.log('🔵 ==========================================\n');
    
    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: amount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });
    
  } catch (error) {
    console.error('❌ Error creating service charge order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message,
    });
  }
});

// ========================================
// 3. CREATE TENANT RENT ORDER WITH AUTO-TRANSFER
// For tenants to pay rent that auto-transfers to property owner
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

    console.log('🔵 ========== TENANT RENT PAYMENT ==========');
    console.log('Property ID:', propertyId);
    console.log('Owner ID:', ownerId);
    console.log('Monthly Rent:', monthlyRent);
    console.log('Security Deposit:', securityDeposit);

    // Validate required fields
    if (!propertyId || !ownerId || !monthlyRent || !securityDeposit) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const totalAmount = parseInt(monthlyRent) + parseInt(securityDeposit);
    console.log('💰 Total Amount: ₹' + totalAmount);

    if (totalAmount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be at least ₹1',
      });
    }

    // Get owner's fund account from database
    const owner = await User.findById(ownerId);
    
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Property owner not found',
      });
    }

    if (!owner.razorpayFundAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Owner has not set up bank account. Please contact property owner.',
      });
    }

    console.log('✅ Owner fund account ID:', owner.razorpayFundAccountId);

    // Create Razorpay order with transfer
    const amountInPaise = totalAmount * 100;
    
    const orderOptions = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `tenant_rent_${Date.now()}`,
      notes: {
        type: 'tenant_rent_payment',
        propertyId: propertyId,
        ownerId: ownerId,
        propertyTitle: propertyTitle || 'Property',
        monthlyRent: monthlyRent,
        securityDeposit: securityDeposit,
        tenantName: tenantName || '',
        tenantEmail: tenantEmail || '',
      },
      // Auto-transfer to owner after payment
      transfers: [
        {
          account: owner.razorpayFundAccountId,
          amount: amountInPaise, // Full amount goes to owner
          currency: 'INR',
          notes: {
            propertyId: propertyId,
            rentPayment: true,
          },
          linked_account_notes: [
            'Rent payment',
          ],
          on_hold: 0, // Transfer immediately (0 = immediate, 1 = hold)
        }
      ]
    };

    console.log('📤 Creating order with auto-transfer...');

    const order = await razorpay.orders.create(orderOptions);

    console.log('✅ Order created with transfer:', order.id);
    console.log('🔵 ==========================================\n');

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: totalAmount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    });

  } catch (error) {
    console.error('❌ Error creating tenant order:', error);
    console.error('Error details:', error.error || error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message,
    });
  }
});

// ========================================
// 4. VERIFY PAYMENT SIGNATURE
// ========================================
router.post('/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      propertyData,
    } = req.body;
    
    console.log('🔍 Verifying payment:', razorpay_payment_id);
    
    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');
    
    if (razorpay_signature === expectedSign) {
      console.log('✅ Payment signature verified');
      
      // TODO: Store payment record in database
      const paymentRecord = {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        propertyId: propertyData?.propertyId,
        ownerId: propertyData?.ownerId,
        amount: propertyData?.amount,
        status: 'success',
        createdAt: new Date(),
      };
      
      console.log('💾 Payment verified:', paymentRecord);
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

// ========================================
// 5. GET PAYMENT DETAILS
// ========================================
router.get('/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    console.log('📋 Fetching payment:', paymentId);
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
      error: error.message,
    });
  }
});

// ========================================
// 6. GET TRANSFER STATUS
// ========================================
router.get('/transfer-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    console.log('📋 Fetching transfers for payment:', paymentId);
    const transfers = await razorpay.payments.fetchTransfers(paymentId);
    
    res.status(200).json({
      success: true,
      transfers: transfers.items,
    });
  } catch (error) {
    console.error('❌ Error fetching transfers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer status',
      error: error.message,
    });
  }
});

// ========================================
// 7. TEST RAZORPAY CONNECTION
// ========================================
router.get('/test-razorpay', async (req, res) => {
  try {
    console.log('🧪 Testing Razorpay connection...');
    
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
    
    console.log('✅ Razorpay test successful!');
    
    res.json({
      success: true,
      message: 'Razorpay is configured correctly!',
      testOrderId: testOrder.id,
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

module.exports = router;
