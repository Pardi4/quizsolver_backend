const mongoose = require('mongoose');
const CreditUsage = require('../models/CreditUsage');

function isMissingIndexError(error) {
  return error?.code === 26 || error?.code === 27 || error?.codeName === 'NamespaceNotFound' || error?.codeName === 'IndexNotFound';
}

async function dropIndexIfExists(collection, indexName) {
  try {
    await collection.dropIndex(indexName);
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
  }
}

async function ensureCreditUsageIndexes() {
  const collection = CreditUsage.collection;
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
  }

  if (indexes.some(index => index.name === 'dedupeExpiresAt_1')) {
    await dropIndexIfExists(collection, 'dedupeExpiresAt_1');
  }

  const dedupeKeyIndex = indexes.find(index => index.name === 'dedupeKey_1');
  if (dedupeKeyIndex && !dedupeKeyIndex.unique) {
    await dropIndexIfExists(collection, 'dedupeKey_1');
  }

  await collection.createIndex(
    { dedupeKey: 1 },
    { unique: true, name: 'dedupeKey_1', background: true }
  );
  await collection.createIndex(
    { user: 1, action: 1, questionHash: 1 },
    { name: 'user_1_action_1_questionHash_1', background: true }
  );
  await collection.createIndex(
    { status: 1, updatedAt: -1 },
    { name: 'status_1_updatedAt_-1', background: true }
  );
  await collection.createIndex(
    { charged: 1, chargedAt: -1 },
    { name: 'charged_1_chargedAt_-1', background: true }
  );
}

async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    await ensureCreditUsageIndexes();
    console.log(`[DB] Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[DB] Connection error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
