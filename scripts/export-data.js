const fs = require('node:fs/promises');
const mongoose = require('mongoose');
const Question = require('../models/Question');
const AppSettings = require('../models/AppSettings');
const Progress = require('../models/Progress');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chemistry_quiz';
const output = process.argv[2] || 'chemistry-quiz-export.json';

(async () => {
  await mongoose.connect(uri);
  const data = {
    questions: await Question.find().lean(),
    appSettings: await AppSettings.find().lean(),
    progress: await Progress.find().lean(),
  };
  await fs.writeFile(output, JSON.stringify(data), 'utf8');
  console.log(`Exported ${data.questions.length} questions, ${data.appSettings.length} settings, ${data.progress.length} progress records to ${output}`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
