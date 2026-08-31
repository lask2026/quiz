const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema(
  {
    learnerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Question',
      index: true,
    },
    subject: { type: String, required: true, trim: true, index: true },
    chapter: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['correct', 'incorrect', 'studied'],
    },
    needsReview: { type: Boolean, required: true, default: false, index: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    correctAttempts: { type: Number, required: true, default: 0, min: 0 },
    incorrectAttempts: { type: Number, required: true, default: 0, min: 0 },
    lastAnswers: { type: [String], default: [] },
    lastAttemptAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

progressSchema.index({ learnerId: 1, questionId: 1 }, { unique: true });
progressSchema.index({ learnerId: 1, subject: 1, needsReview: 1 });

const Progress =
  mongoose.models.Progress || mongoose.model('Progress', progressSchema);

module.exports = Progress;
