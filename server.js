const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const Question = require('./models/Question');
const AppSettings = require('./models/AppSettings');
const { getOrCreateSettings } = require('./models/AppSettings');
const Progress = require('./models/Progress');
const subjectLibrary = require('./data/subjectLibrary');

dotenv.config({ quiet: true });

const app = express();
const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/chemistry_quiz';
const PUBLIC_DIRECTORY = path.join(__dirname, 'public');
const LIBRARY_DIRECTORY = path.join(__dirname, 'library');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(PUBLIC_DIRECTORY));
app.use(
  '/library',
  express.static(LIBRARY_DIRECTORY, { dotfiles: 'deny', fallthrough: false, index: false }),
);

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readFilter(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw createHttpError(400, `${name} must be a non-empty string`);
  }
  if (value.length > 100) {
    throw createHttpError(400, `${name} cannot exceed 100 characters`);
  }
  return value.trim();
}

function parsePositiveInteger(value, name, defaultValue, maximum) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw createHttpError(400, `${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw createHttpError(400, `${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function buildQuestionFilter(query) {
  const filter = {};
  const chapter = readFilter(query.chapter, 'chapter');
  const difficulty = readFilter(query.difficulty, 'difficulty');
  const section = readFilter(query.section, 'section');
  const subject = readFilter(query.subject, 'subject');

  if (subject) filter.subject = subject;
  if (chapter) filter.chapter = chapter;
  if (difficulty) filter['metadata.difficulty'] = difficulty.toLowerCase();
  if (section) filter['metadata.section'] = section;
  return filter;
}

function normalizeStudents(students) {
  if (!Array.isArray(students) || students.length !== 4) {
    throw createHttpError(400, 'Exactly four learner profiles are required');
  }

  const normalized = students.map((student, index) => {
    const name = typeof student?.name === 'string' ? student.name.trim() : '';
    if (!name || name.length > 50) {
      throw createHttpError(400, `Learner ${index + 1} needs a name up to 50 characters`);
    }
    if (!Array.isArray(student.subjects)) {
      throw createHttpError(400, `${name} needs at least one subject`);
    }

    const seen = new Set();
    const subjects = student.subjects
      .map((subject) => (typeof subject === 'string' ? subject.trim() : ''))
      .filter((subject) => {
        const key = subject.toLowerCase();
        if (!subject || subject.length > 50 || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (!subjects.length || subjects.length > 20) {
      throw createHttpError(400, `${name} needs between 1 and 20 valid subjects`);
    }
    const normalizedStudent = { name, subjects };
    if (mongoose.isObjectIdOrHexString(student._id)) normalizedStudent._id = student._id;
    return normalizedStudent;
  });

  const names = normalized.map((student) => student.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    throw createHttpError(400, 'Learner names must be unique');
  }
  return normalized;
}

async function getSettingsResponse() {
  const [settings, subjectCounts] = await Promise.all([
    getOrCreateSettings(),
    Question.aggregate([
      { $group: { _id: { $ifNull: ['$subject', 'Chemistry'] }, count: { $sum: 1 } } },
    ]),
  ]);
  return {
    students: settings.students,
    questionCounts: Object.fromEntries(
      subjectCounts.map((entry) => [entry._id, entry.count]),
    ),
    subjectLibrary,
  };
}

async function requireLearner(learnerId) {
  if (!mongoose.isObjectIdOrHexString(learnerId)) {
    throw createHttpError(400, 'A valid learnerId is required');
  }
  const exists = await AppSettings.exists({ key: 'primary', 'students._id': learnerId });
  if (!exists) throw createHttpError(404, 'Learner not found');
  return new mongoose.Types.ObjectId(learnerId);
}

async function recordProgress({ learnerId, question, status, answers = [] }) {
  if (!learnerId) return;
  const validLearnerId = await requireLearner(learnerId);
  const increments = { attempts: 1 };
  if (status === 'correct') increments.correctAttempts = 1;
  if (status === 'incorrect') increments.incorrectAttempts = 1;

  await Progress.findOneAndUpdate(
    { learnerId: validLearnerId, questionId: question._id },
    {
      $set: {
        subject: question.subject,
        chapter: question.chapter,
        status,
        needsReview: status === 'incorrect',
        lastAnswers: answers,
        lastAttemptAt: new Date(),
      },
      $inc: increments,
    },
    { upsert: true, runValidators: true },
  );
}

function isStudyQuestionDocument(question) {
  const hasOptions = Array.isArray(question?.options) && question.options.length > 0;
  return question?.questionType === 'study' || (!question?.questionType && !hasOptions);
}

app.get('/api/settings', async (req, res, next) => {
  try {
    res.json(await getSettingsResponse());
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const students = normalizeStudents(req.body.students);
    await AppSettings.findOneAndUpdate(
      { key: 'primary' },
      { $set: { students }, $setOnInsert: { key: 'primary' } },
      { returnDocument: 'after', upsert: true, runValidators: true },
    );
    res.json(await getSettingsResponse());
  } catch (error) {
    next(error);
  }
});

app.get('/api/progress', async (req, res, next) => {
  try {
    const learnerId = await requireLearner(req.query.learnerId);
    const subject = readFilter(req.query.subject, 'subject');
    if (!subject) throw createHttpError(400, 'subject is required');

    const [totals, records] = await Promise.all([
      Question.aggregate([
        { $match: { subject } },
        { $group: { _id: '$chapter', total: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Progress.find({ learnerId, subject }).lean(),
    ]);

    const byChapter = Object.fromEntries(
      totals.map((entry) => [
        entry._id,
        { total: entry.total, attempted: 0, correct: 0, review: 0 },
      ]),
    );
    for (const record of records) {
      if (!byChapter[record.chapter]) {
        byChapter[record.chapter] = { total: 0, attempted: 0, correct: 0, review: 0 };
      }
      byChapter[record.chapter].attempted += 1;
      if (record.status === 'correct') byChapter[record.chapter].correct += 1;
      if (record.needsReview) byChapter[record.chapter].review += 1;
    }

    res.json({
      total: totals.reduce((sum, entry) => sum + entry.total, 0),
      attempted: records.length,
      correct: records.filter((record) => record.status === 'correct').length,
      review: records.filter((record) => record.needsReview).length,
      byChapter,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/progress/subjects', async (req, res, next) => {
  try {
    const learnerId = await requireLearner(req.query.learnerId);
    const [questionTotals, progressTotals] = await Promise.all([
      Question.aggregate([
        {
          $group: {
            _id: '$subject',
            total: { $sum: 1 },
            chapters: { $addToSet: '$chapter' },
          },
        },
      ]),
      Progress.aggregate([
        { $match: { learnerId } },
        {
          $group: {
            _id: '$subject',
            attempted: { $sum: 1 },
            correct: {
              $sum: { $cond: [{ $eq: ['$status', 'correct'] }, 1, 0] },
            },
            review: {
              $sum: { $cond: ['$needsReview', 1, 0] },
            },
          },
        },
      ]),
    ]);

    const progressBySubject = Object.fromEntries(
      progressTotals.map((entry) => [entry._id, entry]),
    );
    res.json(
      Object.fromEntries(
        questionTotals.map((entry) => {
          const progress = progressBySubject[entry._id] || {};
          return [
            entry._id,
            {
              total: entry.total,
              chapters: entry.chapters.length,
              attempted: progress.attempted || 0,
              correct: progress.correct || 0,
              review: progress.review || 0,
            },
          ];
        }),
      ),
    );
  } catch (error) {
    next(error);
  }
});

app.get('/api/progress/review', async (req, res, next) => {
  try {
    const learnerId = await requireLearner(req.query.learnerId);
    const subject = readFilter(req.query.subject, 'subject');
    if (!subject) throw createHttpError(400, 'subject is required');

    const missed = await Progress.find({ learnerId, subject, needsReview: true })
      .select('questionId')
      .lean();
    const questions = await Question.find({
      _id: { $in: missed.map((record) => record.questionId) },
      subject,
    })
      .select('-correctAnswer -correctAnswers -solutionText -solutionImageUrl')
      .sort({ chapter: 1, questionNumber: 1 })
      .lean();
    res.json(questions);
  } catch (error) {
    next(error);
  }
});

app.get('/api/questions', async (req, res, next) => {
  try {
    const filter = buildQuestionFilter(req.query);
    const limit = parsePositiveInteger(req.query.limit, 'limit', 100, 200);
    const questions = await Question.find(filter)
      .select('-correctAnswer -correctAnswers -solutionText -solutionImageUrl')
      .sort({ chapter: 1, questionNumber: 1 })
      .limit(limit)
      .lean();

    res.json(questions);
  } catch (error) {
    next(error);
  }
});

app.get('/api/metadata/filters', async (req, res, next) => {
  try {
    const subject = readFilter(req.query.subject, 'subject');
    const filter = subject ? { subject } : {};
    const [chapters, difficulties, sections] = await Promise.all([
      Question.distinct('chapter', filter),
      Question.distinct('metadata.difficulty', filter),
      Question.distinct('metadata.section', filter),
    ]);
    const sortValues = (values) =>
      values.filter(Boolean).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );

    res.json({
      chapters: sortValues(chapters),
      difficulties: sortValues(difficulties),
      sections: sortValues(sections),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/questions/:id/submit', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      throw createHttpError(400, 'Invalid question id');
    }

    const question = await Question.findById(req.params.id)
      .select('subject chapter questionType answerMode correctAnswer correctAnswers options solutionText solutionImageUrl')
      .lean();
    if (!question) throw createHttpError(404, 'Question not found');
    const isLegacyMultipleChoice = !question.questionType && Array.isArray(question.options) && question.options.length > 0;
    if (question.questionType !== 'multiple-choice' && !isLegacyMultipleChoice) {
      await recordProgress({
        learnerId: req.body.learnerId,
        question,
        status: 'studied',
      });
      return res.json({
        correct: null,
        study: true,
        solutionText: question.solutionText || '',
        solutionImageUrl: question.solutionImageUrl || '',
      });
    }

    const selectedAnswers = question.answerMode === 'multiple'
      ? Array.isArray(req.body.selectedAnswers)
        ? req.body.selectedAnswers.map((answer) =>
            typeof answer === 'string' ? answer.trim().toUpperCase() : '',
          )
        : []
      : [
          typeof req.body.selectedAnswer === 'string'
            ? req.body.selectedAnswer.trim().toUpperCase()
            : '',
        ];
    if (
      !selectedAnswers.length ||
      new Set(selectedAnswers).size !== selectedAnswers.length ||
      selectedAnswers.some((answer) => !Question.OPTION_KEYS.includes(answer))
    ) {
      throw createHttpError(400, 'Select one or more unique options from A through F');
    }

    const correctAnswers = question.answerMode === 'multiple'
      ? [...question.correctAnswers]
      : [question.correctAnswer];
    const correct =
      selectedAnswers.length === correctAnswers.length &&
      correctAnswers.every((answer) => selectedAnswers.includes(answer));
    const correctAnswerText = question.options
      .filter((option) => correctAnswers.includes(option.key))
      .map((option) => `${option.key}: ${option.text}`)
      .join('; ');
    await recordProgress({
      learnerId: req.body.learnerId,
      question,
      status: correct ? 'correct' : 'incorrect',
      answers: selectedAnswers,
    });
    res.json({
      correct,
      selectedAnswer: selectedAnswers[0],
      selectedAnswers,
      correctAnswer: correctAnswers[0],
      correctAnswers,
      correctAnswerText,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/questions/:id/solution', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      throw createHttpError(400, 'Invalid question id');
    }
    const question = await Question.findById(req.params.id)
      .select('subject chapter questionType options solutionText solutionImageUrl')
      .lean();
    if (!question) throw createHttpError(404, 'Question not found');
    if (!isStudyQuestionDocument(question)) {
      throw createHttpError(400, 'This question uses answer submission');
    }
    await recordProgress({
      learnerId: req.query.learnerId,
      question,
      status: 'studied',
    });
    res.json({
      solutionText: question.solutionText,
      solutionImageUrl: question.solutionImageUrl,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    database: states[mongoose.connection.readyState] || 'unknown',
  });
});

app.get('*path', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(PUBLIC_DIRECTORY, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status =
    error.status ||
    (error.name === 'CastError' || error.name === 'ValidationError' ? 400 : 500);
  if (status === 500) console.error(error);
  return res.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message,
  });
});

async function connectToDatabase(
  uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGODB_URI,
) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoose.connection;
}

async function startServer() {
  await connectToDatabase();
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`Study Lab is running at http://localhost:${port}`);
  });

  const shutDown = () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Unable to start Study Lab:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, buildQuestionFilter, connectToDatabase, startServer };
