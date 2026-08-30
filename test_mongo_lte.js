const mongoose = require('mongoose');

async function test() {
  await mongoose.connect('mongodb://127.0.0.1:27017/test-db-lte');
  const Schema = new mongoose.Schema({
    email: String,
    accountDeletionScheduledAt: { type: Date, default: null }
  });
  const User = mongoose.model('UserTest', Schema);
  await User.deleteMany({});
  
  await User.create({ email: 'null-date@test.com', accountDeletionScheduledAt: null });
  await User.create({ email: 'future-date@test.com', accountDeletionScheduledAt: new Date(Date.now() + 100000) });
  await User.create({ email: 'past-date@test.com', accountDeletionScheduledAt: new Date(Date.now() - 100000) });
  
  const now = new Date();
  const users = await User.find({ accountDeletionScheduledAt: { $lte: now } });
  
  console.log('Users found with $lte: now ->', users.map(u => u.email));
  process.exit(0);
}
test().catch(console.error);
