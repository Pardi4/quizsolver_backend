const mongoose = require('mongoose');  
  
const clientErrorSchema = new mongoose.Schema({  
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  
  message: { type: String, required: true },  
  stack: { type: String },  
  url: { type: String },  
  source: { type: String, enum: ['extension', 'frontend', 'other'], default: 'other' },  
  userAgent: { type: String },  
  version: { type: String },  
  createdAt: { type: Date, default: Date.now, expires: '30d' } // auto-delete after 30 days  
});  
  
module.exports = mongoose.model('ClientError', clientErrorSchema); 
