const mongoose = require('mongoose');

const DEFAULT_STUDENTS = [
  { name: 'Aanya', subjects: ['Chemistry', 'Biology'] },
  { name: 'Ananya', subjects: ['Chemistry', 'Biology'] },
  { name: 'Lakshman', subjects: ['Chemistry', 'Biology'] },
  { name: 'Susmitha', subjects: ['Chemistry', 'Biology'] },
];

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    subjects: {
      type: [String],
      required: true,
      validate: {
        validator(subjects) {
          return subjects.length >= 1 && subjects.length <= 20;
        },
        message: 'Each learner must have between 1 and 20 subjects',
      },
    },
  },
  { _id: true },
);

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'primary', unique: true, immutable: true },
    students: {
      type: [studentSchema],
      required: true,
      validate: {
        validator(students) {
          return students.length === 4;
        },
        message: 'Exactly four learner profiles are required',
      },
    },
  },
  { timestamps: true, versionKey: false },
);

const AppSettings =
  mongoose.models.AppSettings || mongoose.model('AppSettings', appSettingsSchema);

async function getOrCreateSettings() {
  return AppSettings.findOneAndUpdate(
    { key: 'primary' },
    { $setOnInsert: { key: 'primary', students: DEFAULT_STUDENTS } },
    { returnDocument: 'after', upsert: true, runValidators: true },
  );
}

module.exports = AppSettings;
module.exports.DEFAULT_STUDENTS = DEFAULT_STUDENTS;
module.exports.getOrCreateSettings = getOrCreateSettings;
