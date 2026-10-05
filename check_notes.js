require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const StudyNote = require('./models/StudyNote');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quizsolver');
  
  const focusscan = await StudyNote.countDocuments({ platform: 'focusscan' });
  const selectedText = await StudyNote.countDocuments({ platform: 'selected-text' });
  
  const latestFocus = await StudyNote.findOne({ platform: 'focusscan' }).sort({ createdAt: -1 });
  const latestSelected = await StudyNote.findOne({ platform: 'selected-text' }).sort({ createdAt: -1 });

  console.log('FocusScan count:', focusscan);
  console.log('Selected Text count:', selectedText);

  if (latestFocus) {
    console.log('Latest FocusScan text:', latestFocus.questionText);
    console.log('Has image Base64:', !!latestFocus.questionImageBase64);
  }

  if (latestSelected) {
    console.log('Latest Selected text:', latestSelected.questionText);
  }

  process.exit(0);
}
test().catch(console.error);
