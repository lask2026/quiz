const mongoose = require('mongoose');

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

const optionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: OPTION_KEYS,
      uppercase: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

const questionSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true, default: 'Chemistry', index: true },
    questionType: {
      type: String,
      required: true,
      enum: ['multiple-choice', 'study'],
      default: 'multiple-choice',
      index: true,
    },
    answerMode: {
      type: String,
      required: true,
      enum: ['single', 'multiple'],
      default: 'single',
    },
    book: { type: String, required: true, trim: true, index: true },
    chapter: { type: String, required: true, trim: true, index: true },
    questionNumber: { type: Number, required: true, min: 1 },
    questionText: { type: String, required: true, trim: true },
    imageUrl: { type: String, trim: true, default: '' },
    solutionText: {
      type: String,
      trim: true,
      required() {
        return this.questionType === 'study';
      },
      default: '',
    },
    solutionImageUrl: { type: String, trim: true, default: '' },
    options: {
      type: [optionSchema],
      default: [],
      validate: {
        validator(options) {
          if (this.questionType === 'study') return options.length === 0;
          const keys = options.map((option) => option.key);
          return (
            options.length >= 2 &&
            options.length <= OPTION_KEYS.length &&
            new Set(keys).size === options.length &&
            keys.every((key) => OPTION_KEYS.includes(key))
          );
        },
        message: 'Every question must contain two to six unique options using keys A-F',
      },
    },
    correctAnswer: {
      type: String,
      required() {
        return this.questionType === 'multiple-choice' && this.answerMode === 'single';
      },
      enum: OPTION_KEYS,
      uppercase: true,
      trim: true,
    },
    correctAnswers: {
      type: [String],
      default: [],
      validate: {
        validator(answers) {
          if (this.questionType !== 'multiple-choice' || this.answerMode !== 'multiple') {
            return answers.length === 0;
          }
          return (
            answers.length >= 1 &&
            new Set(answers).size === answers.length &&
            answers.every((answer) => OPTION_KEYS.includes(answer))
          );
        },
        message: 'Multiple-answer questions require unique answer keys A-F',
      },
    },
    metadata: {
      section: { type: String, required: true, trim: true, index: true },
      difficulty: {
        type: String,
        required: true,
        enum: DIFFICULTIES,
        lowercase: true,
        trim: true,
        index: true,
      },
      topic: { type: String, trim: true, default: '' },
      tags: { type: [String], default: [] },
      bloomLevel: { type: String, trim: true, default: '' },
      learningObjective: { type: String, trim: true, default: '' },
      coreConcept: { type: String, trim: true, default: '' },
      coreCompetency: { type: String, trim: true, default: '' },
      accessibility: { type: String, trim: true, default: '' },
      sourceFile: { type: String, trim: true, default: '' },
      parsedAt: Date,
    },
  },
  { timestamps: true, versionKey: false },
);

questionSchema.index(
  { subject: 1, book: 1, chapter: 1, questionNumber: 1 },
  { unique: true },
);
questionSchema.index({ subject: 1, chapter: 1, 'metadata.difficulty': 1, 'metadata.section': 1 });

const Question =
  mongoose.models.Question || mongoose.model('Question', questionSchema);

module.exports = Question;
module.exports.questionSchema = questionSchema;
module.exports.OPTION_KEYS = OPTION_KEYS;
module.exports.DIFFICULTIES = DIFFICULTIES;
