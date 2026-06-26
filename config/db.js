const mongoose = require('mongoose');
const CreditUsage = require('../models/CreditUsage');

async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    await CreditUsage.init();
    console.log(`[DB] Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[DB] Connection error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
