require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const StudyNote = require('./models/StudyNote');
const CachedAnswer = require('./models/CachedAnswer');
const { saveStudyNoteBestEffort } = require('./routes/quiz'); // Won't work easily if it's not exported.

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Create a fake CachedAnswer
  const cachedAnswer = await CachedAnswer.create({
    questionHash: 'test-hash-' + Date.now(),
    questionText: 'Test text selection',
    questionType: 'text',
    answer: '42'
  });

  const body = {
    url: 'https://test.com',
    platform: 'selected-text',
    saveToStudyNotes: true,
    questionData: { text: 'Test text selection', type: 'text' }
  };

  // call upsert directly
  const { imageUpdatesFromBody } = require('./routes/quiz'); // probably not exported
  // we'll just replicate it
  
  const set = {
    questionHash: cachedAnswer.questionHash,
    questionText: cachedAnswer.questionText,
    questionType: cachedAnswer.questionType,
    options: cachedAnswer.options || [],
    prompts: cachedAnswer.prompts || [],
    rows: cachedAnswer.rows || [],
    answer: cachedAnswer.answer,
    lastSeenAt: new Date(),
    platform: 'selected-text'
  };

  const note = await StudyNote.findOneAndUpdate(
    { user: '60c72b2f9b1e8a0015a9d6e4', cachedAnswer: cachedAnswer._id },
    {
      $set: set,
      $setOnInsert: { user: '60c72b2f9b1e8a0015a9d6e4', cachedAnswer: cachedAnswer._id, status: 'new' }
    },
    { new: true, upsert: true }
  );
  
  console.log('Saved note:', note);
  process.exit(0);
}
test().catch(console.error);
