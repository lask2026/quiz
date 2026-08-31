const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const AdmZip = require('adm-zip');
const WordExtractor = require('word-extractor');
const dotenv = require('dotenv');
const Question = require('../models/Question');

dotenv.config({ quiet: true });

const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/chemistry_quiz';
const HEADER_PATTERN = /^(book|chapter|section|difficulty|topic|tags)\s*:\s*(.+)$/i;
const QUESTION_PATTERN = /^(?:question\s*)?(\d+)\s*[.):-]\s*(.+)$/i;
const OPTION_PATTERN = /^([A-F])\s*[.):-]\s*(.*)$/;
const LEGACY_OPTION_PATTERN = /^([A-F])\)\s*(.*)$/;
const ANSWER_PATTERN = /^(?:correct\s+answer|answer)\s*:\s*([A-F](?:\s*,\s*[A-F])*)\s*$/i;
const IMAGE_PATTERN = /^(?:image|image\s*url)\s*:\s*(.+)$/i;
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.doc', '.docx']);
const IMAGE_OUTPUT_DIRECTORY = path.join(__dirname, '..', 'public', 'question-images');

function normalizeDifficulty(value) {
  const match = value.trim().match(/\b(easy|medium|hard)\b/i);
  if (!match) {
    throw new Error(`Unsupported difficulty "${value}"; use easy, medium, or hard`);
  }
  return match[1].toLowerCase();
}

function hasAnswer(question) {
  return Boolean(
    question &&
      (question.correctAnswer ||
        (Array.isArray(question.correctAnswers) && question.correctAnswers.length) ||
        (question.questionType === 'study' && question.solutionText)),
  );
}

function applyAnswer(question, rawAnswer) {
  const answers = rawAnswer
    .toUpperCase()
    .split(',')
    .map((answer) => answer.trim())
    .filter(Boolean);
  if (answers.length > 1) {
    question.answerMode = 'multiple';
    question.correctAnswer = undefined;
    question.correctAnswers = [...new Set(answers)];
  } else {
    question.answerMode = 'single';
    question.correctAnswer = answers[0];
    question.correctAnswers = [];
  }
}

function validateAndStoreQuestion(current, questions, sourceFile) {
  if (!current) return;

  const missing = [];
  if (!current.questionText) missing.push('question text');
  if (current.options.length < 2 || current.options.length > 6) missing.push('two to six options');
  if (!hasAnswer(current)) missing.push('answer');
  if (!current.book) missing.push('book');
  if (!current.chapter) missing.push('chapter');
  if (!current.metadata.section) missing.push('section');
  if (missing.length) {
    throw new Error(
      `${sourceFile}: question ${current.questionNumber} is missing ${missing.join(', ')}`,
    );
  }

  const keys = current.options.map((option) => option.key);
  if (new Set(keys).size !== keys.length || keys.some((key) => !Question.OPTION_KEYS.includes(key))) {
    throw new Error(
      `${sourceFile}: question ${current.questionNumber} must use unique option keys A-F`,
    );
  }
  const answers = current.answerMode === 'multiple' ? current.correctAnswers : [current.correctAnswer];
  if (answers.some((answer) => !keys.includes(answer))) {
    throw new Error(
      `${sourceFile}: question ${current.questionNumber} has an answer without a matching option`,
    );
  }

  current.metadata.parsedAt = new Date();
  current.metadata.sourceFile = sourceFile;
  questions.push(current);
}

function parseTestBank(text, { sourceFile = 'unknown.txt' } = {}) {
  const context = {
    book: '',
    chapter: '',
    section: '',
    difficulty: 'medium',
    topic: '',
    tags: [],
  };
  const questions = [];
  let current = null;
  let lastField = null;

  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^[-=_]{3,}$/.test(line)) continue;

    const answerMatch = line.match(ANSWER_PATTERN);
    if (answerMatch && current) {
      applyAnswer(current, answerMatch[1]);
      lastField = null;
      continue;
    }

    const imageMatch = line.match(IMAGE_PATTERN);
    if (imageMatch && current) {
      current.imageUrl = imageMatch[1].trim();
      lastField = null;
      continue;
    }

    const optionMatch = line.match(OPTION_PATTERN);
    if (optionMatch && current) {
      current.options.push({
        key: optionMatch[1].toUpperCase(),
        text: optionMatch[2].trim() || `See diagram for option ${optionMatch[1].toUpperCase()}`,
      });
      lastField = { type: 'option', index: current.options.length - 1 };
      continue;
    }

    // Numbered statements inside a question are content, not new questions.
    const questionMatch =
      !current || hasAnswer(current) ? line.match(QUESTION_PATTERN) : null;
    if (questionMatch) {
      validateAndStoreQuestion(current, questions, sourceFile);
      current = {
        book: context.book,
        chapter: context.chapter,
        questionNumber: Number(questionMatch[1]),
        questionText: questionMatch[2].trim(),
        answerMode: 'single',
        imageUrl: '',
        options: [],
        correctAnswer: '',
        metadata: {
          section: context.section,
          difficulty: context.difficulty,
          topic: context.topic,
          tags: [...context.tags],
        },
      };
      lastField = { type: 'question' };
      continue;
    }

    const headerMatch = line.match(HEADER_PATTERN);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase();
      const value = headerMatch[2].trim();
      const currentIsComplete = current && hasAnswer(current) && current.options.length >= 2;
      if (
        current &&
        !currentIsComplete &&
        ['section', 'difficulty', 'topic', 'tags'].includes(key)
      ) {
        if (key === 'difficulty') current.metadata.difficulty = normalizeDifficulty(value);
        else if (key === 'tags') {
          current.metadata.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
        } else current.metadata[key] = value;
      } else {
        if (current) {
          validateAndStoreQuestion(current, questions, sourceFile);
          current = null;
        }
        if (key === 'difficulty') context.difficulty = normalizeDifficulty(value);
        else if (key === 'tags') {
          context.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
        } else context[key] = value;
      }
      lastField = null;
      continue;
    }

    if (current && lastField?.type === 'option') {
      current.options[lastField.index].text += ` ${line}`;
    } else if (current && lastField?.type === 'question') {
      current.questionText += ` ${line}`;
    } else {
      throw new Error(`${sourceFile}: could not parse line "${line}"`);
    }
  }

  validateAndStoreQuestion(current, questions, sourceFile);
  if (!questions.length) throw new Error(`${sourceFile}: no questions were found`);
  return questions;
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readRelationships(zip) {
  const entry = zip.getEntry('word/_rels/document.xml.rels');
  if (!entry) return new Map();

  const relationships = new Map();
  const xml = entry.getData().toString('utf8');
  for (const match of xml.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)) {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((attribute) => [
        attribute[1],
        decodeXml(attribute[2]),
      ]),
    );
    if (attributes.Id && attributes.Target) relationships.set(attributes.Id, attributes.Target);
  }
  return relationships;
}

function readDocxParagraphs(zip) {
  const documentEntry = zip.getEntry('word/document.xml');
  if (!documentEntry) throw new Error('The Word file does not contain word/document.xml');

  const xml = documentEntry.getData().toString('utf8');
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => {
    const paragraphXml = match[0];
    const text = [...paragraphXml.matchAll(/<(?:w|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|m):t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join('')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const imageRefs = [
      ...paragraphXml.matchAll(/(?:r:embed|r:id)="([^"]+)"/g),
    ].map((imageMatch) => imageMatch[1]);
    const style = paragraphXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] || '';
    const numId = paragraphXml.match(/<w:numId[^>]*w:val="([^"]+)"/)?.[1] || '';
    const level = paragraphXml.match(/<w:ilvl[^>]*w:val="([^"]+)"/)?.[1] || '';
    return { text, imageRefs: [...new Set(imageRefs)], style, numId, level };
  });
}

function parseDocxTestBank(filePath) {
  const zip = new AdmZip(filePath);
  const relationships = readRelationships(zip);
  const paragraphs = readDocxParagraphs(zip);
  const sourceFile = path.relative(process.cwd(), filePath);
  const visibleParagraphs = paragraphs.filter((paragraph) => paragraph.text);
  const book = visibleParagraphs[0]?.text || 'Organic Chemistry, 6e (Smith)';
  const chapterHeader = visibleParagraphs
    .slice(0, 8)
    .find((paragraph) => /^(?:chapter|spectroscopy)\b/i.test(paragraph.text));
  const chapter = chapterHeader?.text || path.basename(filePath, path.extname(filePath));
  const assets = [];
  const assetNames = new Set();
  const questions = [];
  let current = null;
  let lastField = null;

  function resolveImage(reference) {
    const target = relationships.get(reference);
    if (!target || !/\.(?:png|jpe?g|gif|webp)$/i.test(target)) return '';

    const entryName = path.posix.normalize(path.posix.join('word', target));
    const entry = zip.getEntry(entryName);
    if (!entry) return '';

    const rawName = `${path.basename(filePath, path.extname(filePath))}-${path.posix.basename(target)}`;
    const filename = rawName.replace(/[^a-z0-9_.-]+/gi, '-');
    if (!assetNames.has(filename)) {
      assetNames.add(filename);
      assets.push({ filename, data: entry.getData() });
    }
    return `/question-images/${filename}`;
  }

  function attachFirstImage(paragraph) {
    if (!current || current.imageUrl) return;
    for (const reference of paragraph.imageRefs) {
      const imageUrl = resolveImage(reference);
      if (imageUrl) {
        current.imageUrl = imageUrl;
        break;
      }
    }
  }

  for (const paragraph of paragraphs) {
    const line = paragraph.text;
    // Lists such as "1. Initiation" can appear inside an unfinished question.
    const questionMatch =
      !current || hasAnswer(current) ? line.match(QUESTION_PATTERN) : null;
    if (questionMatch) {
      validateAndStoreQuestion(current, questions, sourceFile);
      current = {
        book,
        chapter,
        questionNumber: Number(questionMatch[1]),
        questionText: questionMatch[2].trim(),
        answerMode: 'single',
        imageUrl: '',
        options: [],
        correctAnswer: '',
        metadata: {
          section: '',
          difficulty: 'medium',
          topic: '',
          tags: [],
          bloomLevel: '',
          accessibility: '',
        },
      };
      lastField = { type: 'question' };
      attachFirstImage(paragraph);
      continue;
    }

    attachFirstImage(paragraph);
    if (!line || !current) continue;

    const optionMatch = line.match(OPTION_PATTERN);
    if (optionMatch) {
      current.options.push({
        key: optionMatch[1].toUpperCase(),
        text: optionMatch[2].trim() || `See diagram for option ${optionMatch[1].toUpperCase()}`,
      });
      lastField = { type: 'option', index: current.options.length - 1 };
      continue;
    }

    const answerMatch = line.match(ANSWER_PATTERN);
    if (answerMatch) {
      applyAnswer(current, answerMatch[1]);
      lastField = null;
      continue;
    }

    const difficultyMatch = line.match(/^Difficulty\s*:\s*(.+)$/i);
    if (difficultyMatch) {
      current.metadata.difficulty = normalizeDifficulty(difficultyMatch[1]);
      lastField = null;
      continue;
    }

    const sectionMatch = line.match(/^Section\s*:\s*(.+)$/i);
    if (sectionMatch) {
      current.metadata.section = sectionMatch[1].trim();
      lastField = null;
      continue;
    }

    const topicMatch = line.match(/^Topic\s*:\s*(.+)$/i);
    if (topicMatch) {
      current.metadata.topic = topicMatch[1].trim();
      lastField = null;
      continue;
    }

    const bloomMatch = line.match(/^Bloom['’]s\s*:\s*(.+)$/i);
    if (bloomMatch) {
      current.metadata.bloomLevel = bloomMatch[1].trim();
      lastField = null;
      continue;
    }

    const accessibilityMatch = line.match(/^Accessibility\s*:\s*(.+)$/i);
    if (accessibilityMatch) {
      current.metadata.accessibility = accessibilityMatch[1].trim();
      lastField = null;
      continue;
    }

    if (/^Chapter\s*:/i.test(line) || /^[\w '’/-]+\s*:/i.test(line)) {
      lastField = null;
      continue;
    }

    if (lastField?.type === 'option') {
      current.options[lastField.index].text += ` ${line}`;
    } else {
      current.questionText += ` ${line}`;
      lastField = { type: 'question' };
    }
  }

  validateAndStoreQuestion(current, questions, sourceFile);
  if (!questions.length) throw new Error(`${sourceFile}: no questions were found`);
  return { questions, assets };
}

function validateAndStoreStudyQuestion(current, questions, sourceFile) {
  if (!current) return;
  if (current.solutionSeen && !current.solutionText) {
    current.solutionText =
      'The source provides this solution as formatted mathematical notation.';
  }
  const missing = [];
  if (!current.questionText) missing.push('question text');
  if (!current.solutionText) missing.push('solution');
  if (!current.book) missing.push('book');
  if (!current.chapter) missing.push('chapter');
  if (missing.length) {
    throw new Error(
      `${sourceFile}: study question ${current.questionNumber} (${current.questionText.slice(0, 90)}) is missing ${missing.join(', ')}`,
    );
  }
  current.metadata.parsedAt = new Date();
  current.metadata.sourceFile = sourceFile;
  delete current.solutionSeen;
  questions.push(current);
}

function parsePhysicsDocx(filePath) {
  const zip = new AdmZip(filePath);
  const relationships = readRelationships(zip);
  const paragraphs = readDocxParagraphs(zip);
  const sourceFile = path.relative(process.cwd(), filePath);
  const visible = paragraphs.filter((paragraph) => paragraph.text);
  const book = visible[0]?.text || 'University Physics';
  const unit = visible.find((paragraph) => /^Unit\s+\d+\s*:/i.test(paragraph.text))?.text || '';
  const chapter =
    visible.find((paragraph) => /^Chapter\s+\d+\s*:/i.test(paragraph.text))?.text ||
    path.basename(filePath, path.extname(filePath));
  const assets = [];
  const assetNames = new Set();
  const questions = [];
  const candidateIndexes = [];
  const questionIndexes = new Set();
  let section = 'Practice';
  let current = null;
  let inSolution = false;
  let questionNumber = 0;

  let detectedSection = 'Practice';
  const paragraphSections = [];
  for (const paragraph of paragraphs) {
    if (/^(?:Conceptual Questions|Problems|Additional Problems|Challenge Problems)$/i.test(paragraph.text)) {
      detectedSection = paragraph.text;
    }
    paragraphSections.push(detectedSection);
  }

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph.style !== 'ListParagraph' || !paragraph.numId || paragraph.level !== '0') {
      continue;
    }
    let hasSolution = false;
    for (let next = index + 1; next < paragraphs.length; next += 1) {
      if (
        paragraphs[next].style === 'ListParagraph' &&
        paragraphs[next].numId === paragraph.numId &&
        paragraphs[next].level === '0'
      ) {
        break;
      }
      if (/^Solution\s*$/i.test(paragraphs[next].text)) {
        hasSolution = true;
        break;
      }
    }
    if (hasSolution) candidateIndexes.push(index);
  }

  const candidateCounts = new Map();
  for (const index of candidateIndexes) {
    const key = `${paragraphSections[index]}\u0000${paragraphs[index].numId}`;
    candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
  }
  const primaryNumberingBySection = new Map();
  for (const [key, count] of candidateCounts) {
    const [candidateSection, numId] = key.split('\u0000');
    if (!primaryNumberingBySection.has(candidateSection)) {
      primaryNumberingBySection.set(candidateSection, { numId, count });
    } else if (count > primaryNumberingBySection.get(candidateSection).count) {
      primaryNumberingBySection.set(candidateSection, { numId, count });
    }
  }
  for (const index of candidateIndexes) {
    if (primaryNumberingBySection.get(paragraphSections[index])?.numId === paragraphs[index].numId) {
      questionIndexes.add(index);
    }
  }

  function resolveImage(reference) {
    const target = relationships.get(reference);
    if (!target || !/\.(?:png|jpe?g|gif|webp)$/i.test(target)) return '';
    const entry = zip.getEntry(path.posix.normalize(path.posix.join('word', target)));
    if (!entry) return '';
    const rawName = `${path.basename(filePath, path.extname(filePath))}-${path.posix.basename(target)}`;
    const filename = rawName.replace(/[^a-z0-9_.-]+/gi, '-');
    if (!assetNames.has(filename)) {
      assetNames.add(filename);
      assets.push({ filename, data: entry.getData() });
    }
    return `/question-images/${filename}`;
  }

  function attachImage(paragraph) {
    if (!current) return;
    const field = inSolution ? 'solutionImageUrl' : 'imageUrl';
    if (current[field]) return;
    for (const reference of paragraph.imageRefs) {
      const imageUrl = resolveImage(reference);
      if (imageUrl) {
        current[field] = imageUrl;
        break;
      }
    }
  }

  paragraphs.forEach((paragraph, index) => {
    const line = paragraph.text;
    if (/^(?:Conceptual Questions|Problems|Additional Problems|Challenge Problems)$/i.test(line)) {
      validateAndStoreStudyQuestion(current, questions, sourceFile);
      current = null;
      section = line;
      inSolution = false;
      return;
    }

    if (questionIndexes.has(index)) {
      validateAndStoreStudyQuestion(current, questions, sourceFile);
      questionNumber += 1;
      current = {
        questionType: 'study',
        book,
        chapter,
        questionNumber,
        questionText: line,
        imageUrl: '',
        solutionText: '',
        solutionSeen: false,
        solutionImageUrl: '',
        options: [],
        metadata: {
          section,
          difficulty: 'medium',
          topic: unit,
          tags: [],
        },
      };
      inSolution = false;
      attachImage(paragraph);
      return;
    }

    if (!current) return;
    if (/^Solution\s*$/i.test(line)) {
      inSolution = true;
      current.solutionSeen = true;
      return;
    }

    attachImage(paragraph);
    if (!line) return;
    if (inSolution) current.solutionText += `${current.solutionText ? ' ' : ''}${line}`;
    else current.questionText += ` ${line}`;
  });

  validateAndStoreStudyQuestion(current, questions, sourceFile);
  if (!questions.length) throw new Error(`${sourceFile}: no question/solution pairs were found`);
  return { questions, assets };
}

function difficultyFromBloom(value) {
  if (/evaluat|creat/i.test(value)) return 'hard';
  if (/apply|analy/i.test(value)) return 'medium';
  return 'easy';
}

async function parseLegacyWordTestBank(filePath) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(filePath);
  const lines = document
    .getBody()
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
  const sourceFile = path.relative(process.cwd(), filePath);
  const book = lines[0] || 'Biological Science';
  const chapter = lines[1] || path.basename(filePath, path.extname(filePath));
  const questions = [];
  const pendingContext = [];
  let current = null;
  let lastField = null;

  function storeCurrentQuestion() {
    if (!current || current.unsupported) return;
    if (current.questionType === 'study') {
      validateAndStoreStudyQuestion(current, questions, sourceFile);
    } else {
      validateAndStoreQuestion(current, questions, sourceFile);
    }
  }

  function startQuestion(questionNumber, questionText) {
    current = {
      questionType: 'multiple-choice',
      book,
      chapter,
      questionNumber,
      questionText: [...pendingContext, questionText].filter(Boolean).join(' '),
      answerMode: 'single',
      imageUrl: '',
      options: [],
      correctAnswer: '',
      metadata: {
        section: 'General',
        difficulty: 'medium',
        topic: chapter.replace(/^Chapter\s+\d+\s*/i, '').trim(),
        tags: [],
        bloomLevel: '',
        learningObjective: '',
        coreConcept: '',
        coreCompetency: '',
      },
    };
    pendingContext.length = 0;
    lastField = { type: 'question' };
  }

  for (const line of lines.slice(2)) {
    const numberOnlyMatch = line.match(/^(\d+)\)$/);
    if (numberOnlyMatch && (!current || hasAnswer(current) || current.unsupported)) {
      storeCurrentQuestion();
      startQuestion(Number(numberOnlyMatch[1]), '');
      continue;
    }

    const questionMatch = line.match(QUESTION_PATTERN);
    if (questionMatch && (!current || hasAnswer(current) || current.unsupported)) {
      storeCurrentQuestion();
      startQuestion(Number(questionMatch[1]), questionMatch[2].trim());
      continue;
    }

    if (!current) continue;
    if (/^Answer\s*:\s*$/i.test(line)) {
      current.unsupported = true;
      lastField = null;
      continue;
    }

    const optionMatch = line.match(LEGACY_OPTION_PATTERN);
    if (optionMatch && !hasAnswer(current)) {
      current.options.push({
        key: optionMatch[1],
        text: optionMatch[2].trim() || `Option ${optionMatch[1]}`,
      });
      lastField = { type: 'option', index: current.options.length - 1 };
      continue;
    }

    const trueFalseMatch = line.match(/^Answer\s*:\s*(TRUE|FALSE)\b/i);
    if (trueFalseMatch) {
      current.options = [
        { key: 'A', text: 'True' },
        { key: 'B', text: 'False' },
      ];
      applyAnswer(current, trueFalseMatch[1].toUpperCase() === 'TRUE' ? 'A' : 'B');
      lastField = null;
      continue;
    }

    const answerMatch = line.match(ANSWER_PATTERN);
    if (answerMatch) {
      applyAnswer(current, answerMatch[1]);
      lastField = null;
      continue;
    }

    const openAnswerMatch = line.match(/^Answer\s*:\s*(.+)$/i);
    if (openAnswerMatch) {
      current.questionType = 'study';
      current.answerMode = 'single';
      current.options = [];
      current.correctAnswer = undefined;
      current.correctAnswers = [];
      current.solutionText = openAnswerMatch[1].trim();
      current.solutionImageUrl = '';
      current.solutionSeen = true;
      lastField = null;
      continue;
    }

    const metadataPatterns = [
      [/^Bloom['’]s Taxonomy\s*:\s*(.+)$/i, 'bloomLevel'],
      [/^V&C Core Concept\s*:\s*(.+)$/i, 'coreConcept'],
      [/^V&C Core Comp\s*:\s*(.+)$/i, 'coreCompetency'],
      [/^LO\s*:\s*(.+)$/i, 'learningObjective'],
      [/^Section\s*:\s*(.+)$/i, 'section'],
    ];
    const metadataMatch = metadataPatterns
      .map(([pattern, field]) => ({ match: line.match(pattern), field }))
      .find((entry) => entry.match);
    if (metadataMatch) {
      current.metadata[metadataMatch.field] = metadataMatch.match[1].trim();
      if (metadataMatch.field === 'bloomLevel') {
        current.metadata.difficulty = difficultyFromBloom(metadataMatch.match[1]);
      }
      lastField = null;
      continue;
    }

    if (current.questionType === 'study') {
      current.solutionText += ` ${line}`;
    } else if (hasAnswer(current)) {
      pendingContext.push(line);
    } else if (lastField?.type === 'option') {
      current.options[lastField.index].text += ` ${line}`;
    } else {
      current.questionText += ` ${line}`;
      lastField = { type: 'question' };
    }
  }

  storeCurrentQuestion();
  if (!questions.length) throw new Error(`${sourceFile}: no questions were found`);
  return { questions, assets: [] };
}

async function collectInputFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  const stats = await fs.stat(resolved);
  if (stats.isFile()) {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
      throw new Error('The input file must use the .txt, .doc, or .docx extension');
    }

    if (/\.docx$/i.test(resolved) && !/_AnswerKey\.docx$/i.test(resolved)) {
      const answerKey = resolved.replace(/\.docx$/i, '_AnswerKey.docx');
      try {
        await fs.access(answerKey);
        return [answerKey];
      } catch {
        return [resolved];
      }
    }
    return [resolved];
  }
  if (!stats.isDirectory()) throw new Error('The input must be a test-bank file or directory');

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(resolved, entry.name);
      if (entry.isDirectory()) return collectInputFiles(entryPath);
      return entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ? [entryPath]
        : [];
    }),
  );
  const files = [...new Set(nested.flat())].sort();
  const available = new Set(files.map((file) => file.toLowerCase()));
  return files.filter((file) => {
    if (!/\.docx$/i.test(file) || /_AnswerKey\.docx$/i.test(file)) return true;
    return !available.has(file.replace(/\.docx$/i, '_AnswerKey.docx').toLowerCase());
  });
}

async function importQuestions(files, { dryRun = false, subject = 'Chemistry' } = {}) {
  const documents = [];
  const assets = [];
  for (const file of files) {
    if (/\.docx$/i.test(file)) {
      const paragraphs = readDocxParagraphs(new AdmZip(file));
      const isQuestionAndSolutionDocument =
        paragraphs.some((paragraph) => /^Solution\s*$/i.test(paragraph.text)) &&
        !paragraphs.some((paragraph) => ANSWER_PATTERN.test(paragraph.text));
      const parsed = isQuestionAndSolutionDocument
        ? parsePhysicsDocx(file)
        : parseDocxTestBank(file);
      documents.push(...parsed.questions);
      assets.push(...parsed.assets);
    } else if (/\.doc$/i.test(file)) {
      const parsed = await parseLegacyWordTestBank(file);
      documents.push(...parsed.questions);
      assets.push(...parsed.assets);
    } else {
      const text = await fs.readFile(file, 'utf8');
      documents.push(
        ...parseTestBank(text, { sourceFile: path.relative(process.cwd(), file) }),
      );
    }
  }

  for (const document of documents) document.subject = subject;
  for (const document of documents) {
    try {
      await new Question(document).validate();
    } catch (error) {
      throw new Error(
        `${document.metadata.sourceFile}: question ${document.questionNumber} failed validation: ${error.message}`,
      );
    }
  }
  if (dryRun) return { parsed: documents.length, imported: 0, images: assets.length };

  if (assets.length) {
    await fs.mkdir(IMAGE_OUTPUT_DIRECTORY, { recursive: true });
    await Promise.all(
      assets.map((asset) =>
        fs.writeFile(path.join(IMAGE_OUTPUT_DIRECTORY, asset.filename), asset.data),
      ),
    );
  }

  const operations = documents.map((document) => ({
    updateOne: {
      filter: {
        subject: document.subject,
        book: document.book,
        chapter: document.chapter,
        questionNumber: document.questionNumber,
      },
      update: { $set: document },
      upsert: true,
    },
  }));
  const result = await Question.bulkWrite(operations, { ordered: true });
  return {
    parsed: documents.length,
    imported: result.upsertedCount + result.modifiedCount,
    images: assets.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const subjectIndex = args.indexOf('--subject');
  const subject = subjectIndex >= 0 ? args[subjectIndex + 1]?.trim() : 'Chemistry';
  const positionalArguments = args.filter(
    (argument, index) =>
      !argument.startsWith('--') && !(subjectIndex >= 0 && index === subjectIndex + 1),
  );
  const inputPath = positionalArguments[0];
  if (!inputPath) {
    throw new Error(
      'Usage: npm run parse -- <file-or-directory> [--subject Chemistry] [--dry-run]',
    );
  }
  if (!subject) throw new Error('--subject requires a non-empty subject name');

  const files = await collectInputFiles(inputPath);
  if (!files.length) throw new Error('No .txt, .doc, or .docx test-bank files were found');

  if (!dryRun) {
    await mongoose.connect(
      process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGODB_URI,
    );
  }

  try {
    const result = await importQuestions(files, { dryRun, subject });
    const action = dryRun ? 'validated' : 'imported';
    console.log(
      `${result.parsed} ${subject} question(s) ${action} from ${files.length} file(s); ${result.images} image(s) found.`,
    );
  } finally {
    if (!dryRun) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Parser error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  collectInputFiles,
  findTextFiles: collectInputFiles,
  importQuestions,
  parseLegacyWordTestBank,
  parsePhysicsDocx,
  parseDocxTestBank,
  parseTestBank,
};
