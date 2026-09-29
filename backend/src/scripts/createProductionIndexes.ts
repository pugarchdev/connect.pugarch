import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend/.env if not already passed in process.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Import all models to ensure schemas and indexes are registered
import WhatsAppSession from '../models/WhatsAppSession';
import ProcessedWhatsAppMessage from '../models/ProcessedWhatsAppMessage';
import CitizenProfile from '../models/CitizenProfile';
import AuditLog from '../models/AuditLog';
import ChatbotFlow from '../models/ChatbotFlow';
import Company from '../models/Company';
import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import Department from '../models/Department';
import Grievance from '../models/Grievance';
import Appointment from '../models/Appointment';
import User from '../models/User';

const TARGET_MODELS = [
  { name: 'ProcessedWhatsAppMessage', model: ProcessedWhatsAppMessage },
  { name: 'WhatsAppSession', model: WhatsAppSession },
  { name: 'CitizenProfile', model: CitizenProfile },
  { name: 'AuditLog', model: AuditLog },
  { name: 'ChatbotFlow', model: ChatbotFlow },
  { name: 'CompanyWhatsAppConfig', model: CompanyWhatsAppConfig },
  { name: 'Company', model: Company },
  { name: 'Department', model: Department },
  { name: 'Grievance', model: Grievance },
  { name: 'Appointment', model: Appointment },
  { name: 'User', model: User }
];

async function createIndexes() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error('❌ MONGODB_URI environment variable is required.');
    console.error('   Usage example:');
    console.error('   $env:MONGODB_URI="mongodb://admin:pass@host:27017/db?authSource=admin"; npm run create:indexes');
    process.exit(1);
  }

  // Mask credentials for display
  const maskedUri = mongoUri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@.+)/, '$1******$2');
  console.log(`🔌 Connecting to MongoDB: ${maskedUri}`);

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      family: 4
    });
    console.log(`✅ Successfully connected to database: "${mongoose.connection.name}" at ${mongoose.connection.host}`);
  } catch (err: any) {
    console.error(`❌ Connection failed: ${err.message}`);
    process.exit(1);
  }

  console.log('\n🚀 Starting Index Creation & Optimization across all collections...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const { name, model } of TARGET_MODELS) {
    try {
      const collectionName = model.collection.name;
      const count = await model.countDocuments().catch(() => 'unknown');
      console.log(`────────────────────────────────────────────────────────────`);
      console.log(`📦 Collection: [${collectionName}] (${name}) | Total Documents: ${count}`);

      // 1. Get existing indexes before
      const existingBefore = await model.collection.indexes().catch(() => []);
      console.log(`   Existing indexes (${existingBefore.length}):`);
      for (const idx of existingBefore) {
        console.log(`     - ${idx.name}: ${JSON.stringify(idx.key)}${idx.expireAfterSeconds !== undefined ? ` (TTL: ${idx.expireAfterSeconds}s)` : ''}${idx.unique ? ' (UNIQUE)' : ''}`);
      }

      // 2. Trigger Mongoose schema index creation
      console.log(`   ⚡ Building schema indexes...`);
      await model.createIndexes();

      // 3. Verify newly created indexes
      const existingAfter = await model.collection.indexes();
      console.log(`   ✅ Active indexes after build (${existingAfter.length}):`);
      for (const idx of existingAfter) {
        console.log(`     ✓ ${idx.name}: ${JSON.stringify(idx.key)}${idx.expireAfterSeconds !== undefined ? ` (TTL: ${idx.expireAfterSeconds}s)` : ''}`);
      }

      successCount++;
    } catch (error: any) {
      console.error(`   ❌ Failed to create indexes for ${name}: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`🏁 Index Creation Completed!`);
  console.log(`   Successful collections: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);

  await mongoose.disconnect();
  console.log(`🔌 Disconnected from MongoDB. Chatbot queries will now execute instantly.`);
}

createIndexes().catch((err) => {
  console.error('❌ Unexpected fatal error:', err);
  process.exit(1);
});
