// ========================================
// CRON JOB - AUTO-SUSPEND OVERDUE PROPERTIES
// File: utils/propertyStatusCron.js (NEW FILE)
// ✅ Runs daily to check and suspend properties with overdue payments
// ✅ Updates property status based on payment due dates
// ========================================

const cron = require('node-cron');
const Property = require('../models/Property');

// ⭐ Run daily at 2 AM
const startPropertyStatusCron = () => {
  console.log('🕒 Starting property status cron job (runs daily at 2 AM)...');
  
  // Schedule: '0 2 * * *' = Every day at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('\n⏰ ==================== PROPERTY STATUS CHECK ====================');
    console.log('⏰ Running at:', new Date().toISOString());
    
    try {
      // 1. Find all properties that need status update
      const properties = await Property.findPropertiesNeedingUpdate();
      console.log(`📋 Found ${properties.length} properties to check`);
      
      let updatedCount = 0;
      
      for (const property of properties) {
        const status = property.getPaymentStatus();
        const now = new Date();
        const daysUntilDue = Math.ceil((property.serviceDueDate - now) / (1000 * 60 * 60 * 24));
        
        // Update status based on days until due
        if (status === 'suspended' && property.serviceStatus !== 'suspended') {
          // Suspend property - grace period ended
          property.serviceStatus = 'suspended';
          property.isActive = false;
          property.suspendedAt = now;
          property.gracePeriodEndsAt = now;
          property.suspensionReason = 'Service charge payment overdue (10+ days)';
          
          await property.save();
          updatedCount++;
          
          console.log(`⏸️  Suspended: ${property.title} (ID: ${property._id})`);
          console.log(`   Due date was: ${property.serviceDueDate}`);
          console.log(`   Days overdue: ${Math.abs(daysUntilDue)}`);
          
        } else if (status === 'overdue' && property.serviceStatus !== 'overdue') {
          // Mark as overdue - in grace period
          property.serviceStatus = 'overdue';
          property.gracePeriodEndsAt = new Date(property.serviceDueDate);
          property.gracePeriodEndsAt.setDate(property.gracePeriodEndsAt.getDate() + 10);
          
          await property.save();
          updatedCount++;
          
          console.log(`⚠️  Overdue: ${property.title} (ID: ${property._id})`);
          console.log(`   Grace period ends: ${property.gracePeriodEndsAt}`);
          console.log(`   Days remaining: ${Math.max(0, 10 + daysUntilDue)}`);
          
        } else if (status === 'due' && property.serviceStatus !== 'due') {
          // Mark as due soon
          property.serviceStatus = 'due';
          await property.save();
          updatedCount++;
          
          console.log(`📅 Due soon: ${property.title} (ID: ${property._id})`);
          console.log(`   Due date: ${property.serviceDueDate}`);
          console.log(`   Days until due: ${daysUntilDue}`);
        }
      }
      
      console.log(`✅ Updated ${updatedCount} properties`);
      console.log('⏰ ==================== STATUS CHECK COMPLETE ====================\n');
      
    } catch (error) {
      console.error('❌ Error in property status cron:', error);
      console.log('⏰ ==================== STATUS CHECK FAILED ====================\n');
    }
  });
  
  console.log('✅ Property status cron job started');
};

// ⭐ Manual trigger for testing
const runPropertyStatusCheck = async () => {
  console.log('\n🔧 ==================== MANUAL STATUS CHECK ====================');
  
  try {
    const properties = await Property.findPropertiesNeedingUpdate();
    console.log(`📋 Found ${properties.length} properties to check`);
    
    let updatedCount = 0;
    
    for (const property of properties) {
      const status = property.getPaymentStatus();
      const now = new Date();
      const daysUntilDue = Math.ceil((property.serviceDueDate - now) / (1000 * 60 * 60 * 24));
      
      if (status === 'suspended' && property.serviceStatus !== 'suspended') {
        property.serviceStatus = 'suspended';
        property.isActive = false;
        property.suspendedAt = now;
        property.gracePeriodEndsAt = now;
        property.suspensionReason = 'Service charge payment overdue (10+ days)';
        
        await property.save();
        updatedCount++;
        
        console.log(`⏸️  Suspended: ${property.title}`);
        
      } else if (status === 'overdue' && property.serviceStatus !== 'overdue') {
        property.serviceStatus = 'overdue';
        property.gracePeriodEndsAt = new Date(property.serviceDueDate);
        property.gracePeriodEndsAt.setDate(property.gracePeriodEndsAt.getDate() + 10);
        
        await property.save();
        updatedCount++;
        
        console.log(`⚠️  Overdue: ${property.title}`);
        
      } else if (status === 'due' && property.serviceStatus !== 'due') {
        property.serviceStatus = 'due';
        await property.save();
        updatedCount++;
        
        console.log(`📅 Due soon: ${property.title}`);
      }
    }
    
    console.log(`✅ Updated ${updatedCount} properties`);
    console.log('🔧 ==================== MANUAL CHECK COMPLETE ====================\n');
    
    return { success: true, updated: updatedCount };
    
  } catch (error) {
    console.error('❌ Error in manual status check:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  startPropertyStatusCron,
  runPropertyStatusCheck
};