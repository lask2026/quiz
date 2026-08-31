const fs = require('node:fs');
const mongoose = require('mongoose');
const Question = require('../models/Question');
const AppSettings = require('../models/AppSettings');
const Progress = require('../models/Progress');

const input = process.argv[2] || 'chemistry-quiz-export.json';
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chemistry_quiz';

(async () => {
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  await mongoose.connect(uri);
  await Question.deleteMany({});
  await AppSettings.deleteMany({});
  await Progress.deleteMany({});
  if (data.questions.length) await Question.insertMany(data.questions, { ordered: false });
  if (data.appSettings.length) await AppSettings.insertMany(data.appSettings, { ordered: false });
  if (data.progress.length) await Progress.insertMany(data.progress, { ordered: false });
  console.log(`Imported ${data.questions.length} questions, ${data.appSettings.length} settings, ${data.progress.length} progress records`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
