const state = {
  students: [],
  questionCounts: {},
  subjectSummaries: {},
  selectedStudentIndex: null,
  selectedSubject: '',
  chapters: [],
  progress: null,
  activeChapter: '',
  mode: 'chapter',
  returnView: 'subjects',
  questions: [],
  reviewQuestions: [],
  currentIndex: 0,
  selectedAnswer: null,
  answers: new Map(),
  workspaceToken: 0,
  questionToken: 0,
  summaryToken: 0,
  sessionStartedAt: 0,
  timerId: null,
};

const elementIds = [
  'global-status', 'dashboard-shell', 'mobile-menu-button', 'mobile-home-button',
  'mobile-profile-button', 'sidebar-backdrop', 'dashboard-sidebar', 'close-mobile-menu',
  'brand-home-button', 'nav-home', 'nav-subjects', 'nav-learners', 'nav-review',
  'sidebar-review-count', 'nav-progress', 'nav-manage', 'sidebar-avatar',
  'sidebar-learner-name', 'sidebar-learner-detail', 'sidebar-manage-button',
  'home-view', 'home-heading', 'student-grid', 'subjects-view', 'back-to-students',
  'student-eyebrow', 'subjects-heading', 'subject-overview', 'subject-grid',
  'review-view', 'review-heading', 'review-total', 'review-learner-label',
  'review-subject-select', 'review-loading', 'review-empty', 'review-list',
  'quiz-view', 'practice-menu-button', 'exit-quiz-button', 'session-timer',
  'quiz-context', 'quiz-section-label', 'quiz-difficulty-label', 'quiz-review-button',
  'quiz-review-count', 'practice-backdrop', 'practice-sidebar', 'practice-subject-label',
  'close-practice-menu', 'chapter-nav', 'chapter-progress-label', 'question-nav',
  'quiz-status', 'loading-state', 'empty-state', 'quiz-panel', 'question-scroll',
  'quiz-columns', 'prompt-pane', 'response-pane', 'question-position', 'book-label',
  'question-heading', 'question-image', 'options-list', 'feedback', 'feedback-title',
  'feedback-state-badge', 'feedback-detail', 'solution-image', 'feedback-review-note',
  'previous-button', 'result-count', 'submit-button', 'next-button', 'settings-dialog',
  'settings-form', 'settings-fields', 'settings-error', 'close-settings',
  'cancel-settings', 'save-settings',
];

const elements = Object.fromEntries(
  elementIds.map((id) => [
    id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
    document.getElementById(id),
  ]),
);

const numberFormatter = new Intl.NumberFormat();
const profileColors = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-500'];

function currentStudent() {
  return state.students[state.selectedStudentIndex] || null;
}

function isStudyQuestion(question) {
  const type = String(question?.questionType || '').trim().toLowerCase();
  return type === 'study' || type === 'study-question' || !Array.isArray(question?.options) || question.options.length === 0;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body
      ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
      : options.headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function showGlobalMessage(message = '', tone = 'error') {
  if (!message) {
    elements.globalStatus.className = 'hidden status-toast';
    elements.globalStatus.textContent = '';
    return;
  }
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  elements.globalStatus.className = `status-toast ${tones[tone] || tones.error}`;
  elements.globalStatus.textContent = message;
}

function showQuizMessage(message = '', tone = 'error') {
  if (!message) {
    elements.quizStatus.className = 'mb-3 hidden rounded-xl border px-4 py-2.5 text-sm font-semibold';
    elements.quizStatus.textContent = '';
    return;
  }
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  elements.quizStatus.className = `mb-3 rounded-xl border px-4 py-2.5 text-sm font-semibold ${tones[tone] || tones.error}`;
  elements.quizStatus.textContent = message;
}

function showSettingsError(message = '') {
  elements.settingsError.classList.toggle('hidden', !message);
  elements.settingsError.textContent = message;
}

function setActiveNav(active) {
  const links = {
    home: elements.navHome,
    subjects: elements.navSubjects,
    learners: elements.navLearners,
    review: elements.navReview,
    progress: elements.navProgress,
    manage: elements.navManage,
  };
  Object.entries(links).forEach(([name, element]) => {
    element.classList.toggle('active', name === active);
  });
}

function setDashboardView(view, activeNav = view) {
  elements.dashboardShell.classList.remove('hidden');
  elements.quizView.classList.add('hidden');
  elements.homeView.classList.toggle('hidden', view !== 'home');
  elements.subjectsView.classList.toggle('hidden', view !== 'subjects');
  elements.reviewView.classList.toggle('hidden', view !== 'review');
  document.body.classList.remove('overflow-hidden');
  setActiveNav(activeNav);
  closeDashboardMenu();
}

function setQuizVisible(visible) {
  elements.dashboardShell.classList.toggle('hidden', visible);
  elements.quizView.classList.toggle('hidden', !visible);
  document.body.classList.toggle('overflow-hidden', visible);
  if (!visible) closePracticeMenu();
}

function openDashboardMenu() {
  elements.dashboardSidebar.classList.add('open');
  elements.sidebarBackdrop.classList.add('open');
}

function closeDashboardMenu() {
  elements.dashboardSidebar.classList.remove('open');
  elements.sidebarBackdrop.classList.remove('open');
}

function openPracticeMenu() {
  elements.practiceSidebar.classList.add('open');
  elements.practiceBackdrop.classList.add('open');
}

function closePracticeMenu() {
  elements.practiceSidebar.classList.remove('open');
  elements.practiceBackdrop.classList.remove('open');
}

function updateProfileChrome() {
  const student = currentStudent();
  const initials = student ? student.name.slice(0, 2).toUpperCase() : '?';
  const color = profileColors[(state.selectedStudentIndex ?? 1) % profileColors.length];
  [elements.sidebarAvatar, elements.mobileProfileButton].forEach((element) => {
    element.textContent = initials;
    element.className = element.className
      .replace(/bg-(blue|violet|emerald|amber)-(500|600)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    element.classList.add(...color.split(' '));
  });
  elements.sidebarLearnerName.textContent = student?.name || 'Choose learner';
  elements.sidebarLearnerDetail.textContent = student
    ? `${student.subjects.length} subjects`
    : 'Study profile';
  const reviewTotal = Object.values(state.subjectSummaries).reduce(
    (sum, summary) => sum + (summary.review || 0),
    0,
  );
  elements.sidebarReviewCount.textContent = numberFormatter.format(reviewTotal);
}

function createLearnerCard(student, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-card group flex flex-col p-5 text-left focus:outline-none focus:ring-4 focus:ring-blue-100';
  const header = document.createElement('span');
  header.className = 'flex items-center justify-between';
  const avatar = document.createElement('span');
  avatar.className = `grid h-12 w-12 place-items-center rounded-full text-sm font-bold text-white ${profileColors[index % profileColors.length]}`;
  avatar.textContent = student.name.slice(0, 2).toUpperCase();
  const arrow = document.createElement('span');
  arrow.className = 'text-lg text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#3483f9]';
  arrow.textContent = '→';
  header.append(avatar, arrow);
  const name = document.createElement('span');
  name.className = 'display-font mt-5 block text-xl font-bold';
  name.textContent = student.name;
  const total = student.subjects.reduce(
    (sum, subject) => sum + (state.questionCounts[subject] || 0),
    0,
  );
  const details = document.createElement('span');
  details.className = 'mt-1 block text-xs font-medium text-slate-400';
  details.textContent = `${student.subjects.length} subjects · ${numberFormatter.format(total)} questions`;
  const footer = document.createElement('span');
  footer.className = 'mt-auto block pt-5 text-xs font-bold text-[#3483f9]';
  footer.textContent = 'Open study profile';
  button.append(header, name, details, footer);
  button.addEventListener('click', () => selectStudent(index));
  return button;
}

function renderStudents() {
  elements.studentGrid.replaceChildren();
  state.students.forEach((student, index) => {
    elements.studentGrid.append(createLearnerCard(student, index));
  });
}

function createSegments(percent) {
  const container = document.createElement('div');
  container.className = 'mt-3 flex gap-1';
  const filled = Math.round((Math.min(percent, 100) / 100) * 8);
  for (let index = 0; index < 8; index += 1) {
    const segment = document.createElement('span');
    segment.className = `segment${index < filled ? ' filled' : ''}`;
    container.append(segment);
  }
  return container;
}

function createSubjectCard(subject) {
  const summary = state.subjectSummaries[subject] || {
    total: state.questionCounts[subject] || 0,
    chapters: 0,
    attempted: 0,
    correct: 0,
    review: 0,
  };
  const completion = summary.total ? Math.round((summary.attempted / summary.total) * 100) : 0;
  const accuracy = summary.attempted ? Math.round((summary.correct / summary.attempted) * 100) : 0;
  const card = document.createElement('article');
  card.className = 'app-card overflow-hidden border border-slate-100';

  const body = document.createElement('div');
  body.className = 'p-5';
  const titleRow = document.createElement('div');
  titleRow.className = 'flex items-start justify-between gap-3';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'display-font text-xl font-bold';
  title.textContent = subject;
  const counts = document.createElement('p');
  counts.className = 'mt-1 text-xs font-medium text-slate-400';
  counts.textContent = `${numberFormatter.format(summary.total)} questions · ${summary.chapters || '—'} chapters`;
  titleWrap.append(title, counts);
  const reviewBadge = document.createElement('span');
  reviewBadge.className = summary.review
    ? 'rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-600'
    : 'rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600';
  reviewBadge.textContent = summary.review ? `${summary.review} review` : 'Up to date';
  titleRow.append(titleWrap, reviewBadge);

  const metrics = document.createElement('div');
  metrics.className = 'mt-7 grid grid-cols-2 gap-5';
  const accuracyBlock = document.createElement('div');
  accuracyBlock.innerHTML = `<p class="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Accuracy</p><p class="mt-1 text-lg font-bold text-slate-800">${summary.attempted ? `${accuracy}%` : '—'}</p>`;
  const completionBlock = document.createElement('div');
  completionBlock.innerHTML = `<p class="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Completed</p><p class="mt-1 text-lg font-bold text-slate-800">${numberFormatter.format(summary.attempted)}<span class="text-xs text-slate-400">/${numberFormatter.format(summary.total)}</span></p>`;
  metrics.append(accuracyBlock, completionBlock);
  body.append(titleRow, metrics, createSegments(completion));

  const footer = document.createElement('div');
  footer.className = 'flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3';
  const reviewButton = document.createElement('button');
  reviewButton.type = 'button';
  reviewButton.className = 'press-button press-white px-4 py-2 text-xs';
  reviewButton.textContent = `Review ${summary.review || ''}`.trim();
  reviewButton.disabled = summary.review === 0;
  reviewButton.addEventListener('click', () => openReviewLog(subject));
  const practiceButton = document.createElement('button');
  practiceButton.type = 'button';
  practiceButton.className = 'press-button press-green min-w-32 px-5 py-2 text-xs';
  practiceButton.textContent = 'Practice  ›';
  practiceButton.disabled = summary.total === 0;
  practiceButton.addEventListener('click', () => openSubject(subject));
  footer.append(reviewButton, practiceButton);
  card.append(body, footer);
  return card;
}

function renderSubjectOverview() {
  const student = currentStudent();
  const totals = student?.subjects.reduce(
    (result, subject) => {
      const summary = state.subjectSummaries[subject] || {};
      result.attempted += summary.attempted || 0;
      result.correct += summary.correct || 0;
      result.review += summary.review || 0;
      return result;
    },
    { attempted: 0, correct: 0, review: 0 },
  ) || { attempted: 0, correct: 0, review: 0 };
  elements.subjectOverview.replaceChildren();
  [
    `${numberFormatter.format(totals.attempted)} attempted`,
    `${numberFormatter.format(totals.correct)} correct`,
    `${numberFormatter.format(totals.review)} to review`,
  ].forEach((text, index) => {
    if (index) {
      const divider = document.createElement('span');
      divider.className = 'h-5 w-px bg-slate-200';
      elements.subjectOverview.append(divider);
    }
    const item = document.createElement('span');
    item.className = 'font-semibold';
    item.textContent = text;
    elements.subjectOverview.append(item);
  });
}

function renderSubjects() {
  const student = currentStudent();
  if (!student) return;
  elements.studentEyebrow.textContent = `${student.name}'s study space`;
  elements.subjectGrid.replaceChildren();
  student.subjects.forEach((subject) => elements.subjectGrid.append(createSubjectCard(subject)));
  renderSubjectOverview();
  updateProfileChrome();
}

async function loadSubjectSummaries() {
  const student = currentStudent();
  if (!student?._id) return;
  const token = ++state.summaryToken;
  try {
    const params = new URLSearchParams({ learnerId: student._id });
    const summaries = await request(`/api/progress/subjects?${params}`);
    if (token !== state.summaryToken) return;
    state.subjectSummaries = summaries;
    renderSubjects();
  } catch (error) {
    if (token !== state.summaryToken) return;
    showGlobalMessage(`Progress could not be loaded: ${error.message}`, 'warning');
  }
}

function selectStudent(index) {
  state.selectedStudentIndex = index;
  state.selectedSubject = '';
  state.subjectSummaries = {};
  updateProfileChrome();
  renderSubjects();
  setDashboardView('subjects', 'subjects');
  elements.subjectsHeading.focus();
  loadSubjectSummaries();
}

async function loadSettings() {
  try {
    const data = await request('/api/settings');
    state.students = data.students || [];
    state.questionCounts = data.questionCounts || {};
    renderStudents();
    updateProfileChrome();
  } catch (error) {
    showGlobalMessage(`Learners could not be loaded: ${error.message}`);
  }
}

function emptyProgress(chapters = []) {
  return {
    total: 0,
    attempted: 0,
    correct: 0,
    review: 0,
    byChapter: Object.fromEntries(
      chapters.map((chapter) => [chapter, { total: 0, attempted: 0, correct: 0, review: 0 }]),
    ),
  };
}

function chapterStats(chapter) {
  return state.progress?.byChapter?.[chapter] || { total: 0, attempted: 0, correct: 0, review: 0 };
}

function setQuestionArea(view) {
  elements.loadingState.classList.toggle('hidden', view !== 'loading');
  elements.emptyState.classList.toggle('hidden', view !== 'empty');
  elements.quizPanel.classList.toggle('hidden', view !== 'question');
}

function startTimer() {
  stopTimer();
  state.sessionStartedAt = Date.now();
  const update = () => {
    const seconds = Math.floor((Date.now() - state.sessionStartedAt) / 1000);
    const minutes = Math.floor(seconds / 60);
    elements.sessionTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  update();
  state.timerId = window.setInterval(update, 1000);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
}

async function loadQuizScaffold(subject, token) {
  const student = currentStudent();
  const metadataParams = new URLSearchParams({ subject });
  const metadata = await request(`/api/metadata/filters?${metadataParams}`);
  if (token !== state.workspaceToken) return false;
  state.chapters = metadata.chapters || [];
  state.progress = emptyProgress(state.chapters);
  try {
    const progressParams = new URLSearchParams({ learnerId: student._id, subject });
    state.progress = await request(`/api/progress?${progressParams}`);
  } catch (error) {
    showQuizMessage(`Questions loaded, but progress is temporarily unavailable: ${error.message}`, 'warning');
  }
  if (token !== state.workspaceToken) return false;
  renderChapterNavigation();
  return true;
}

async function openSubject(subject) {
  const student = currentStudent();
  if (!student?._id) {
    showGlobalMessage('Choose a learner first.');
    setDashboardView('home', 'home');
    return;
  }
  state.selectedSubject = subject;
  state.mode = 'chapter';
  state.returnView = 'subjects';
  state.activeChapter = '';
  state.questions = [];
  state.answers = new Map();
  elements.practiceSubjectLabel.textContent = subject;
  setQuizVisible(true);
  startTimer();
  setQuestionArea('loading');
  showQuizMessage();
  const token = ++state.workspaceToken;
  ++state.questionToken;
  try {
    if (!(await loadQuizScaffold(subject, token))) return;
    if (!state.chapters.length) {
      setQuestionArea('empty');
      return;
    }
    await selectChapter(state.chapters[0]);
  } catch (error) {
    if (token !== state.workspaceToken) return;
    state.chapters = [];
    state.progress = emptyProgress();
    renderChapterNavigation();
    setQuestionArea('empty');
    showQuizMessage(`Chapters could not be loaded: ${error.message}`);
  }
}

function renderChapterNavigation() {
  const progress = state.progress || emptyProgress(state.chapters);
  elements.chapterNav.replaceChildren();
  state.chapters.forEach((chapter) => {
    const stats = chapterStats(chapter);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chapter-button${state.mode === 'chapter' && state.activeChapter === chapter ? ' active' : ''}`;
    button.textContent = chapter;
    button.title = `${stats.attempted}/${stats.total} attempted${stats.review ? ` · ${stats.review} missed` : ''}`;
    button.addEventListener('click', () => {
      closePracticeMenu();
      selectChapter(chapter);
    });
    elements.chapterNav.append(button);
  });
  elements.quizReviewCount.textContent = numberFormatter.format(progress.review || 0);
  elements.quizReviewButton.disabled = !progress.review;
  elements.sidebarReviewCount.textContent = numberFormatter.format(progress.review || 0);
  if (state.activeChapter) {
    const stats = chapterStats(state.activeChapter);
    elements.chapterProgressLabel.textContent = `${stats.attempted}/${stats.total} attempted`;
  } else {
    elements.chapterProgressLabel.textContent = `${state.questions.length} to review`;
  }
  renderQuestionNavigation();
}

function renderQuestionNavigation() {
  elements.questionNav.replaceChildren();
  if (!state.questions.length) return;
  const groups = new Map();
  state.questions.forEach((question, index) => {
    const difficulty = question.metadata?.difficulty || 'practice';
    if (!groups.has(difficulty)) groups.set(difficulty, []);
    groups.get(difficulty).push({ question, index });
  });
  const colors = { easy: 'text-emerald-600', medium: 'text-amber-500', hard: 'text-red-500', practice: 'text-violet-500' };
  ['easy', 'medium', 'hard', 'practice'].forEach((difficulty) => {
    const entries = groups.get(difficulty);
    if (!entries?.length) return;
    const section = document.createElement('section');
    section.className = 'mb-5';
    const heading = document.createElement('p');
    heading.className = `mb-2 text-[10px] font-bold uppercase tracking-[.1em] ${colors[difficulty]}`;
    heading.textContent = difficulty;
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-5 gap-2';
    entries.forEach(({ question, index }) => {
      const answer = state.answers.get(question._id);
      const button = document.createElement('button');
      button.type = 'button';
      let status = '';
      if (answer?.result) {
        status = isStudyQuestion(question) || answer.result.correct ? ' correct' : ' incorrect';
      }
      if (index === state.currentIndex) status = ' current';
      button.className = `question-number${status}`;
      button.textContent = index + 1;
      button.setAttribute('aria-label', `Question ${index + 1}`);
      button.addEventListener('click', () => {
        state.currentIndex = index;
        closePracticeMenu();
        renderQuestion(true);
      });
      grid.append(button);
    });
    section.append(heading, grid);
    elements.questionNav.append(section);
  });
}

async function selectChapter(chapter) {
  state.mode = 'chapter';
  state.returnView = 'subjects';
  state.activeChapter = chapter;
  state.questions = [];
  state.currentIndex = 0;
  state.selectedAnswer = null;
  state.answers = new Map();
  renderChapterNavigation();
  setQuestionArea('loading');
  showQuizMessage();
  const token = ++state.questionToken;
  try {
    const params = new URLSearchParams({ subject: state.selectedSubject, chapter, limit: '200' });
    const questions = await request(`/api/questions?${params}`);
    if (token !== state.questionToken) return;
    state.questions = questions;
    state.currentIndex = 0;
    if (!questions.length) {
      setQuestionArea('empty');
      renderQuestionNavigation();
      return;
    }
    setQuestionArea('question');
    renderQuestionNavigation();
    renderQuestion(true);
  } catch (error) {
    if (token !== state.questionToken) return;
    setQuestionArea('empty');
    showQuizMessage(`Questions could not be loaded: ${error.message}`);
  }
}

async function refreshProgress() {
  const student = currentStudent();
  if (!student || !state.selectedSubject) return;
  try {
    const params = new URLSearchParams({ learnerId: student._id, subject: state.selectedSubject });
    state.progress = await request(`/api/progress?${params}`);
    renderChapterNavigation();
  } catch (error) {
    showQuizMessage(`Answer saved, but progress could not be refreshed: ${error.message}`, 'warning');
  }
}

function populateReviewSubjects() {
  const student = currentStudent();
  elements.reviewSubjectSelect.replaceChildren();
  student.subjects.forEach((subject) => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    elements.reviewSubjectSelect.append(option);
  });
  if (!student.subjects.includes(state.selectedSubject)) state.selectedSubject = student.subjects[0];
  elements.reviewSubjectSelect.value = state.selectedSubject;
}

async function openReviewLog(subject = state.selectedSubject) {
  const student = currentStudent();
  if (!student?._id) {
    showGlobalMessage('Choose a learner before opening the mistake log.');
    setDashboardView('home', 'home');
    return;
  }
  if (subject && student.subjects.includes(subject)) state.selectedSubject = subject;
  if (!state.selectedSubject) state.selectedSubject = student.subjects[0];
  setDashboardView('review', 'review');
  populateReviewSubjects();
  elements.reviewLearnerLabel.textContent = `for ${student.name}`;
  elements.reviewHeading.focus();
  await loadReviewList();
}

async function loadReviewList() {
  const student = currentStudent();
  elements.reviewLoading.classList.remove('hidden');
  elements.reviewEmpty.classList.add('hidden');
  elements.reviewList.classList.add('hidden');
  try {
    const params = new URLSearchParams({ learnerId: student._id, subject: state.selectedSubject });
    state.reviewQuestions = await request(`/api/progress/review?${params}`);
    elements.reviewTotal.textContent = `${numberFormatter.format(state.reviewQuestions.length)} to review`;
    renderReviewList();
  } catch (error) {
    elements.reviewLoading.textContent = `Mistakes could not be loaded: ${error.message}`;
  }
}

function renderReviewList() {
  elements.reviewLoading.classList.add('hidden');
  elements.reviewList.replaceChildren();
  if (!state.reviewQuestions.length) {
    elements.reviewEmpty.classList.remove('hidden');
    return;
  }
  elements.reviewList.classList.remove('hidden');
  const header = document.createElement('div');
  header.className = 'review-row bg-slate-50 text-[9px] font-bold uppercase tracking-[.1em] text-slate-400';
  header.innerHTML = '<span>Problem</span><span class="review-secondary">Chapter</span><span class="review-secondary">Difficulty</span><span>Action</span>';
  elements.reviewList.append(header);
  state.reviewQuestions.forEach((question, index) => {
    const row = document.createElement('div');
    row.className = 'review-row';
    const text = document.createElement('p');
    text.className = 'line-clamp-2 text-xs font-medium leading-5';
    text.textContent = question.questionText;
    const chapter = document.createElement('p');
    chapter.className = 'review-secondary truncate text-[11px] text-slate-500';
    chapter.textContent = question.chapter;
    const difficulty = document.createElement('span');
    difficulty.className = 'review-secondary w-fit rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold capitalize text-[#3483f9]';
    difficulty.textContent = question.metadata?.difficulty || 'practice';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'press-button press-blue px-3 py-2 text-xs';
    button.textContent = 'Review';
    button.addEventListener('click', () => openReviewQuiz(index));
    row.append(text, chapter, difficulty, button);
    elements.reviewList.append(row);
  });
}

async function openReviewQuiz(startIndex = 0) {
  if (!state.reviewQuestions.length) return;
  state.mode = 'review';
  state.returnView = 'review';
  state.activeChapter = '';
  state.questions = state.reviewQuestions;
  state.currentIndex = Math.min(startIndex, state.questions.length - 1);
  state.selectedAnswer = null;
  state.answers = new Map();
  elements.practiceSubjectLabel.textContent = state.selectedSubject;
  setQuizVisible(true);
  startTimer();
  setQuestionArea('loading');
  showQuizMessage();
  const token = ++state.workspaceToken;
  ++state.questionToken;
  try {
    if (!(await loadQuizScaffold(state.selectedSubject, token))) return;
    state.questions = state.reviewQuestions;
    setQuestionArea('question');
    renderChapterNavigation();
    renderQuestion(true);
  } catch (error) {
    if (token !== state.workspaceToken) return;
    setQuestionArea('empty');
    showQuizMessage(`Review could not be opened: ${error.message}`);
  }
}

function selectedKeys() {
  if (Array.isArray(state.selectedAnswer)) return state.selectedAnswer;
  return state.selectedAnswer ? [state.selectedAnswer] : [];
}

function optionClass(key, answerRecord) {
  const selected = selectedKeys().includes(key);
  if (answerRecord?.result) {
    const result = answerRecord.result;
    const correctKeys = result.correctAnswers || (result.correctAnswer ? [result.correctAnswer] : []);
    if (correctKeys.includes(key)) return 'border-emerald-500 bg-emerald-50 text-emerald-950 shadow-[0_3px_0_#10b981]';
    if (selected) return 'border-red-500 bg-red-50 text-red-950 shadow-[0_3px_0_#ef4444]';
    return 'border-slate-200 bg-white text-slate-400 shadow-[0_3px_0_#e2e8f0]';
  }
  return selected
    ? 'border-[#3483f9] bg-blue-50 text-slate-900 shadow-[0_3px_0_#2563d8]'
    : 'border-slate-200 bg-white text-slate-800 shadow-[0_3px_0_#e2e8f0] hover:border-blue-300';
}

function renderQuestion(focusHeading = false) {
  const question = state.questions[state.currentIndex];
  if (!question) {
    setQuestionArea('empty');
    return;
  }
  const answerRecord = state.answers.get(question._id);
  state.selectedAnswer = answerRecord?.selected ?? null;
  const answered = Boolean(answerRecord?.result);
  const isStudy = isStudyQuestion(question);
  const isMultiple = question.answerMode === 'multiple';
  const stats = state.activeChapter ? chapterStats(state.activeChapter) : null;

  elements.quizContext.textContent = state.mode === 'review' ? 'Mistake Review' : question.chapter;
  elements.quizSectionLabel.textContent = question.metadata?.section || question.chapter;
  elements.quizDifficultyLabel.textContent = question.metadata?.difficulty || 'practice';
  elements.questionPosition.textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
  elements.resultCount.textContent = state.mode === 'review'
    ? `${state.questions.length} in review`
    : stats
      ? `${stats.correct} correct · ${stats.attempted}/${stats.total} attempted`
      : '';
  elements.bookLabel.textContent = [question.book, question.questionNumber ? `#${question.questionNumber}` : ''].filter(Boolean).join(' · ');
  elements.questionHeading.textContent = question.questionText;

  if (question.imageUrl) {
    elements.questionImage.src = question.imageUrl;
    elements.questionImage.classList.remove('hidden');
    elements.questionImage.onerror = () => elements.questionImage.classList.add('hidden');
  } else {
    elements.questionImage.removeAttribute('src');
    elements.questionImage.classList.add('hidden');
  }

  if (answered) {
    elements.promptPane.append(elements.optionsList);
    elements.optionsList.className = 'mt-7 grid gap-3';
  } else {
    elements.responsePane.insertBefore(elements.optionsList, elements.feedback);
    elements.optionsList.className = 'grid gap-4';
  }
  elements.optionsList.replaceChildren();

  if (isStudy) {
    const note = document.createElement('div');
    note.className = 'rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium leading-6 text-slate-600';
    note.textContent = answered
      ? 'The worked solution is shown in the explanation panel.'
      : 'Work through the question, then reveal the solution when you are ready.';
    elements.optionsList.append(note);
  } else {
    if (isMultiple && !answered) {
      const note = document.createElement('p');
      note.className = 'mb-1 text-xs font-semibold text-[#3483f9]';
      note.textContent = 'Select every answer that applies.';
      elements.optionsList.append(note);
    }
    question.options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = answered;
      button.className = `answer-option flex items-start gap-3 border-[1.5px] p-4 text-left text-sm font-medium leading-6 transition ${optionClass(option.key, answerRecord)}`;
      button.setAttribute('aria-pressed', String(selectedKeys().includes(option.key)));
      const key = document.createElement('span');
      key.className = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500';
      if (answered) {
        const correctKeys = answerRecord.result.correctAnswers || [answerRecord.result.correctAnswer];
        if (correctKeys.includes(option.key)) key.className = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500 text-xs font-bold text-white';
        else if (selectedKeys().includes(option.key)) key.className = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-500 text-xs font-bold text-white';
      } else if (selectedKeys().includes(option.key)) {
        key.className = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#3483f9] text-xs font-bold text-white';
      }
      key.textContent = option.key;
      const text = document.createElement('span');
      text.className = 'pt-1';
      text.textContent = option.text;
      button.append(key, text);
      button.addEventListener('click', () => selectAnswer(option.key, isMultiple));
      elements.optionsList.append(button);
    });
  }

  renderFeedback(question, answerRecord);
  elements.previousButton.disabled = state.currentIndex === 0;
  elements.submitButton.textContent = isStudy ? 'Show solution  ›' : 'Check  ›';
  elements.submitButton.disabled = answered || (!isStudy && selectedKeys().length === 0);
  elements.submitButton.classList.toggle('hidden', answered);
  elements.nextButton.classList.toggle('hidden', !answered);
  elements.nextButton.textContent = state.currentIndex === state.questions.length - 1 ? 'Finish  ›' : 'Next  ›';
  elements.questionScroll.scrollTop = 0;
  renderQuestionNavigation();
  if (focusHeading) elements.questionHeading.focus({ preventScroll: true });
}

function renderFeedback(question, answerRecord) {
  const result = answerRecord?.result;
  if (!result) {
    elements.feedback.classList.add('hidden');
    elements.solutionImage.classList.add('hidden');
    elements.solutionImage.removeAttribute('src');
    return;
  }
  elements.feedback.classList.remove('hidden');
  elements.feedbackTitle.textContent = 'Explanation';
  if (isStudyQuestion(question)) {
    elements.feedbackStateBadge.className = 'rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#3483f9]';
    elements.feedbackStateBadge.textContent = 'Studied';
    elements.feedbackDetail.textContent = result.solutionText || 'No written solution was included for this question.';
    elements.feedbackReviewNote.className = 'mt-6 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800';
    elements.feedbackReviewNote.textContent = 'This question has been marked as studied.';
    if (result.solutionImageUrl) {
      elements.solutionImage.src = result.solutionImageUrl;
      elements.solutionImage.classList.remove('hidden');
      elements.solutionImage.onerror = () => elements.solutionImage.classList.add('hidden');
    } else {
      elements.solutionImage.classList.add('hidden');
      elements.solutionImage.removeAttribute('src');
    }
    return;
  }

  const selectedText = question.options
    .filter((option) => selectedKeys().includes(option.key))
    .map((option) => `${option.key}: ${option.text}`)
    .join('; ');
  if (result.correct) {
    elements.feedbackStateBadge.className = 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600';
    elements.feedbackStateBadge.textContent = 'Correct';
    elements.feedbackDetail.textContent = `You selected ${selectedText}.\n\nThat matches the correct answer.`;
    elements.feedbackReviewNote.className = 'mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800';
    elements.feedbackReviewNote.textContent = '✓ Progress saved. This question is clear from your mistake log.';
  } else {
    elements.feedbackStateBadge.className = 'rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600';
    elements.feedbackStateBadge.textContent = 'Incorrect';
    const correctAnswer = result.correctAnswerText || result.correctAnswers?.join(', ') || result.correctAnswer || 'the highlighted option';
    elements.feedbackDetail.textContent = `You selected ${selectedText || 'an incorrect option'}.\n\nThe correct answer is ${correctAnswer}.`;
    elements.feedbackReviewNote.className = 'mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800';
    elements.feedbackReviewNote.textContent = '↻ Added to your mistake log for another attempt.';
  }
  elements.solutionImage.classList.add('hidden');
  elements.solutionImage.removeAttribute('src');
}

function selectAnswer(key, isMultiple) {
  const question = state.questions[state.currentIndex];
  if (!question || state.answers.get(question._id)?.result) return;
  if (isMultiple) {
    const values = new Set(Array.isArray(state.selectedAnswer) ? state.selectedAnswer : []);
    if (values.has(key)) values.delete(key);
    else values.add(key);
    state.selectedAnswer = [...values];
  } else {
    state.selectedAnswer = key;
  }
  state.answers.set(question._id, { selected: state.selectedAnswer, result: null });
  renderQuestion();
}

async function submitAnswer() {
  const question = state.questions[state.currentIndex];
  const student = currentStudent();
  if (!question || !student || state.answers.get(question._id)?.result) return;
  elements.submitButton.disabled = true;
  showQuizMessage();
  try {
    let result;
    if (isStudyQuestion(question)) {
      const params = new URLSearchParams({ learnerId: student._id });
      result = await request(`/api/questions/${encodeURIComponent(question._id)}/solution?${params}`);
      state.selectedAnswer = [];
    } else {
      const payload = question.answerMode === 'multiple'
        ? { learnerId: student._id, selectedAnswers: selectedKeys() }
        : { learnerId: student._id, selectedAnswer: selectedKeys()[0] };
      result = await request(`/api/questions/${encodeURIComponent(question._id)}/submit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    state.answers.set(question._id, { selected: state.selectedAnswer, result });
    renderQuestion();
    await refreshProgress();
  } catch (error) {
    showQuizMessage(`Answer could not be saved: ${error.message}`);
    elements.submitButton.disabled = false;
  }
}

function moveQuestion(direction) {
  const nextIndex = state.currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.questions.length) return;
  state.currentIndex = nextIndex;
  renderQuestion(true);
}

async function finishOrNext() {
  if (state.currentIndex < state.questions.length - 1) {
    moveQuestion(1);
    return;
  }
  await exitQuiz(state.returnView);
}

async function exitQuiz(destination = state.returnView) {
  ++state.workspaceToken;
  ++state.questionToken;
  stopTimer();
  setQuizVisible(false);
  if (destination === 'review') {
    await openReviewLog(state.selectedSubject);
  } else if (currentStudent()) {
    setDashboardView('subjects', 'subjects');
    renderSubjects();
    loadSubjectSummaries();
  } else {
    setDashboardView('home', 'home');
  }
}

function openSettings() {
  elements.settingsFields.replaceChildren();
  state.students.forEach((student, index) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'rounded-2xl border border-slate-200 bg-blue-50/50 p-4';
    const legend = document.createElement('legend');
    legend.className = 'rounded-lg bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700';
    legend.textContent = `Learner ${index + 1}`;
    const row = document.createElement('div');
    row.className = 'mt-2 grid gap-3 sm:grid-cols-[180px_1fr]';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'text-xs font-semibold text-slate-500';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.name = `name-${index}`;
    nameInput.required = true;
    nameInput.maxLength = 50;
    nameInput.value = student.name;
    nameInput.className = 'mt-1 h-11 w-full rounded-xl border-[1.5px] border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-[#3483f9] focus:ring-4 focus:ring-blue-100';
    nameLabel.append(nameInput);
    const subjectLabel = document.createElement('label');
    subjectLabel.className = 'text-xs font-semibold text-slate-500';
    subjectLabel.textContent = 'Subjects';
    const subjectInput = document.createElement('input');
    subjectInput.name = `subjects-${index}`;
    subjectInput.required = true;
    subjectInput.value = student.subjects.join(', ');
    subjectInput.className = nameInput.className;
    subjectLabel.append(subjectInput);
    row.append(nameLabel, subjectLabel);
    fieldset.append(legend, row);
    elements.settingsFields.append(fieldset);
  });
  showSettingsError();
  if (typeof elements.settingsDialog.showModal === 'function') elements.settingsDialog.showModal();
  else elements.settingsDialog.setAttribute('open', '');
}

function closeSettings() {
  if (typeof elements.settingsDialog.close === 'function') elements.settingsDialog.close();
  else elements.settingsDialog.removeAttribute('open');
}

async function saveSettings(event) {
  event.preventDefault();
  const formData = new FormData(elements.settingsForm);
  const students = state.students.map((student, index) => ({
    _id: student._id,
    name: String(formData.get(`name-${index}`) || '').trim(),
    subjects: String(formData.get(`subjects-${index}`) || '').split(',').map((value) => value.trim()).filter(Boolean),
  }));
  elements.saveSettings.disabled = true;
  elements.saveSettings.textContent = 'Saving...';
  showSettingsError();
  try {
    const data = await request('/api/settings', { method: 'PUT', body: JSON.stringify({ students }) });
    state.students = data.students;
    state.questionCounts = data.questionCounts || {};
    renderStudents();
    closeSettings();
    if (state.selectedStudentIndex !== null) {
      state.subjectSummaries = {};
      renderSubjects();
      loadSubjectSummaries();
    }
    updateProfileChrome();
    showGlobalMessage('Learners and subjects updated.', 'success');
  } catch (error) {
    showSettingsError(error.message);
  } finally {
    elements.saveSettings.disabled = false;
    elements.saveSettings.textContent = 'Save';
  }
}

function showLearners() {
  setDashboardView('home', 'learners');
  elements.homeHeading.focus?.();
}

function showSubjects(activeNav = 'subjects') {
  if (!currentStudent()) {
    showGlobalMessage('Choose a learner first.');
    showLearners();
    return;
  }
  renderSubjects();
  setDashboardView('subjects', activeNav);
  elements.subjectsHeading.focus();
}

elements.mobileMenuButton.addEventListener('click', openDashboardMenu);
elements.closeMobileMenu.addEventListener('click', closeDashboardMenu);
elements.sidebarBackdrop.addEventListener('click', closeDashboardMenu);
elements.practiceMenuButton.addEventListener('click', openPracticeMenu);
elements.closePracticeMenu.addEventListener('click', closePracticeMenu);
elements.practiceBackdrop.addEventListener('click', closePracticeMenu);
elements.brandHomeButton.addEventListener('click', () => setDashboardView('home', 'home'));
elements.mobileHomeButton.addEventListener('click', () => setDashboardView('home', 'home'));
elements.navHome.addEventListener('click', () => setDashboardView('home', 'home'));
elements.navLearners.addEventListener('click', showLearners);
elements.navSubjects.addEventListener('click', () => showSubjects('subjects'));
elements.navProgress.addEventListener('click', () => showSubjects('progress'));
elements.navReview.addEventListener('click', () => openReviewLog());
elements.navManage.addEventListener('click', openSettings);
elements.sidebarManageButton.addEventListener('click', openSettings);
elements.mobileProfileButton.addEventListener('click', () => currentStudent() ? showSubjects() : showLearners());
elements.backToStudents.addEventListener('click', showLearners);
elements.reviewSubjectSelect.addEventListener('change', (event) => {
  state.selectedSubject = event.target.value;
  loadReviewList();
});
elements.exitQuizButton.addEventListener('click', () => exitQuiz());
elements.quizReviewButton.addEventListener('click', () => exitQuiz('review'));
elements.previousButton.addEventListener('click', () => moveQuestion(-1));
elements.submitButton.addEventListener('click', submitAnswer);
elements.nextButton.addEventListener('click', finishOrNext);
elements.closeSettings.addEventListener('click', closeSettings);
elements.cancelSettings.addEventListener('click', closeSettings);
elements.settingsForm.addEventListener('submit', saveSettings);

setDashboardView('home', 'home');
loadSettings();
