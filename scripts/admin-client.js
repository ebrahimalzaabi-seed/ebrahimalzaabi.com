let allFatawa = [];
let selectedFatwaId = '';
let selectedFatwaTitle = '';
let selectedFatwaEmail = '';

// -- Custom alert and confirm dialogs --------------------------------
function showAlert(msg) {
  var overlay = document.getElementById('alert-overlay');
  document.getElementById('alert-msg').textContent = msg;
  overlay.classList.add('open');
  function close() {
    overlay.classList.remove('open');
    document.getElementById('alert-ok').removeEventListener('click', close);
  }
  document.getElementById('alert-ok').addEventListener('click', close);
}

function showConfirm(msg) {
  return new Promise(function(resolve) {
    var overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-msg').textContent = msg;
    overlay.classList.add('open');
    function cleanup(val) {
      overlay.classList.remove('open');
      document.getElementById('confirm-yes').removeEventListener('click', onYes);
      document.getElementById('confirm-no').removeEventListener('click', onNo);
      resolve(val);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    document.getElementById('confirm-yes').addEventListener('click', onYes);
    document.getElementById('confirm-no').addEventListener('click', onNo);
  });
}

function toggleTranscriptBtn(youtubeInputId, btnId) {
  var val = (document.getElementById(youtubeInputId).value || '').trim();
  document.getElementById(btnId).disabled = !val;
}

// -- Load fatawa --------------------------------------------------
async function loadFatawa() {
  try {
    const res = await fetch('/api/fatawa');
    allFatawa = await res.json();
  } catch (e) {
    console.error('Failed to load fatawa:', e);
  }
}

// -- Fatwa list (main section) ------------------------------------
function renderManageList(filter) {
  const listEl = document.getElementById('manage-list');
  const q = (filter || '').trim().toLowerCase();
  const filtered = q
    ? allFatawa.filter(f => f.id.toLowerCase().includes(q) || f.title.includes(filter.trim()))
    : allFatawa;

  if (filtered.length === 0) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c</div>';
    selectedFatwaId = '';
    selectedFatwaTitle = '';
    selectedFatwaEmail = '';
    return;
  }
  // Show only latest 3 when no search filter
  var display = q ? filtered : filtered.slice(0, 3);
  listEl.innerHTML = '';
  display.forEach(function(f) {
    var row = document.createElement('div');
    row.className = 'fatwa-row' + (f.id === selectedFatwaId ? ' selected' : '');
    row.innerHTML =
      '<div class="fatwa-row-info">' +
        '<div class="fatwa-row-title">' + f.title + '</div>' +
        '<span class="fatwa-row-id">' + f.id + '</span>' +
      '</div>' +
      '<div class="fatwa-row-actions">' +
        '<button class="btn btn-gold btn-edit">&#1578;&#1593;&#1583;&#1610;&#1604;</button>' +
        '<button class="btn btn-notify-action btn-notify-row">&#1573;&#1585;&#1587;&#1575;&#1604; &#1573;&#1588;&#1593;&#1575;&#1585;</button>' +
        '<button class="btn btn-danger btn-del-row">&#1581;&#1584;&#1601;</button>' +
        '<select class="open-in-sel">' +
          '<option value="" disabled selected>&#1601;&#1578;&#1581; &#1601;&#1610;...</option>' +
          '<option value="dev">Dev (localhost:1313)</option>' +
          '<option value="prod">Production</option>' +
        '</select>' +
      '</div>';
    row.addEventListener('click', function() { selectFatwaRow(f.id, f.title, f.email || '', row); });
    row.querySelector('.btn-edit').addEventListener('click', function(e) { e.stopPropagation(); openEditModal(f.id); });
    row.querySelector('.btn-notify-row').addEventListener('click', function(e) { e.stopPropagation(); selectFatwaRow(f.id, f.title, f.email || '', row); openNotifyModal(); });
    row.querySelector('.btn-del-row').addEventListener('click', function(e) { e.stopPropagation(); quickDelete(f.id, f.title); });
    row.querySelector('.open-in-sel').addEventListener('click', function(e) { e.stopPropagation(); });
    row.querySelector('.open-in-sel').addEventListener('change', function(e) {
      e.stopPropagation();
      var base = e.target.value === 'dev' ? 'http://localhost:1313' : 'https://ebrahimalzaabi.com';
      window.open(base + '/fatawa/posts/' + f.id + '/', '_blank');
      e.target.selectedIndex = 0;
    });
    listEl.appendChild(row);
  });
}

function filterManageList() {
  renderManageList(document.getElementById('manage-search').value);
}

function selectFatwaRow(id, title, email, clickedRow) {
  // Toggle: clicking the same row again deselects it
  if (selectedFatwaId === id) {
    selectedFatwaId = '';
    selectedFatwaTitle = '';
    selectedFatwaEmail = '';
    if (clickedRow) clickedRow.classList.remove('selected');
    return;
  }
  selectedFatwaId = id;
  selectedFatwaTitle = title;
  selectedFatwaEmail = email;

  // Highlight selected row
  document.querySelectorAll('#manage-list .fatwa-row').forEach(function(r) {
    r.classList.remove('selected');
  });
  if (clickedRow) clickedRow.classList.add('selected');

  // Pre-fill email if available
  document.getElementById('fatwa-email').value = email || '';

  // Clear notify results when switching fatwa
  clearNotifyResults();
}

// -- Notify modal -------------------------------------------------
function openNotifyModal() {
  clearNotifyResults();
  if (selectedFatwaEmail) {
    document.getElementById('fatwa-email').value = selectedFatwaEmail;
  }
  document.getElementById('notify-modal-title').textContent = '\u0625\u0631\u0633\u0627\u0644 \u0625\u0634\u0639\u0627\u0631: ' + selectedFatwaTitle;
  document.getElementById('notify-modal').classList.add('open');
}

function closeNotifyModal() {
  document.getElementById('notify-modal').classList.remove('open');
}

// -- Notify fatwa -------------------------------------------------
async function notifyFatwa() {
  var btn = document.getElementById('btn-notify');
  var status = document.getElementById('notify-status');
  var wrap = document.getElementById('notify-output-wrap');
  var output = document.getElementById('notify-output');
  var fatwaId = selectedFatwaId;
  var email = document.getElementById('fatwa-email').value.trim();
  var dryRun = document.getElementById('notify-dry-run').checked;

  if (!fatwaId) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0627\u062e\u062a\u064a\u0627\u0631 \u0641\u062a\u0648\u0649'); return; }
  if (!email || !email.includes('@')) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0628\u0631\u064a\u062f \u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a \u0635\u062d\u064a\u062d'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> <span>\u062c\u0627\u0631\u064f \u0627\u0644\u0625\u0631\u0633\u0627\u0644...</span>';
  status.innerHTML = '';
  wrap.classList.remove('visible');
  output.className = 'output';
  output.textContent = '';

  try {
    var res = await fetch('/api/notify-fatwa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fatwaId: fatwaId, email: email, dryRun: dryRun }),
    });
    var data = await res.json();

    output.textContent = data.output || '(no output)';
    wrap.classList.add('visible');

    if (data.success) {
      output.classList.add('success');
      status.innerHTML = '<div class="status-badge success">\u2713 \u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631 \u0628\u0646\u062c\u0627\u062d</div>';
    } else {
      output.classList.add('error');
      status.innerHTML = '<div class="status-badge error">\u2717 \u0641\u0634\u0644 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631</div>';
    }
  } catch (e) {
    output.textContent = e.message;
    wrap.classList.add('visible');
    output.classList.add('error');
    status.innerHTML = '<div class="status-badge error">\u2717 \u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0627\u062a\u0635\u0627\u0644</div>';
  }

  btn.disabled = false;
  btn.innerHTML = '<span>\u0625\u0631\u0633\u0627\u0644</span>';
}

function clearNotifyResults() {
  document.getElementById('notify-status').innerHTML = '';
  document.getElementById('notify-output-wrap').classList.remove('visible');
  var output = document.getElementById('notify-output');
  output.className = 'output';
  output.textContent = '';
}

// -- Build index --------------------------------------------------
async function buildIndex() {
  var btn = document.getElementById('btn-build-index');
  var status = document.getElementById('build-status');
  var wrap = document.getElementById('build-output-wrap');
  var output = document.getElementById('build-output');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> <span>\u062c\u0627\u0631\u064f \u0627\u0644\u0628\u0646\u0627\u0621...</span>';
  status.innerHTML = '';
  wrap.classList.remove('visible');
  output.className = 'output';
  output.textContent = '';

  try {
    var res = await fetch('/api/build-index', { method: 'POST' });
    var data = await res.json();

    output.textContent = data.output || '(no output)';
    wrap.classList.add('visible');

    if (data.success) {
      output.classList.add('success');
      status.innerHTML = '<div class="status-badge success">\u2713 \u062a\u0645 \u0628\u0646\u0627\u0621 \u0627\u0644\u0641\u0647\u0631\u0633 \u0628\u0646\u062c\u0627\u062d</div>';
    } else {
      output.classList.add('error');
      status.innerHTML = '<div class="status-badge error">\u2717 \u0641\u0634\u0644 \u0628\u0646\u0627\u0621 \u0627\u0644\u0641\u0647\u0631\u0633</div>';
    }
  } catch (e) {
    output.textContent = e.message;
    wrap.classList.add('visible');
    output.classList.add('error');
    status.innerHTML = '<div class="status-badge error">\u2717 \u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0627\u062a\u0635\u0627\u0644</div>';
  }

  btn.disabled = false;
  btn.innerHTML = '<span>\u0625\u0639\u0627\u062f\u0629 \u0628\u0646\u0627\u0621 \u0627\u0644\u0641\u0647\u0631\u0633</span>';
}

function clearBuildResults() {
  document.getElementById('build-status').innerHTML = '';
  document.getElementById('build-output-wrap').classList.remove('visible');
  var output = document.getElementById('build-output');
  output.className = 'output';
  output.textContent = '';
}

// -- Create fatwa -------------------------------------------------
let selectedCategories = new Set();
let allCategories = [];

async function loadFatwaMeta() {
  try {
    var res = await fetch('/api/fatwa-meta');
    var meta = await res.json();
    document.getElementById('new-fatwa-id').textContent = '#' + meta.nextId;
    document.getElementById('nf-date').value = meta.date;
    allCategories = meta.categories;
    renderCategories();
  } catch (e) {
    console.error('Failed to load fatwa meta:', e);
  }
}

function renderCategories() {
  var container = document.getElementById('nf-categories');
  container.innerHTML = '';
  allCategories.forEach(function(c) {
    var span = document.createElement('span');
    span.className = 'cat-tag' + (selectedCategories.has(c) ? ' selected' : '');
    span.textContent = c;
    span.addEventListener('click', function() { toggleCategory(span, c); });
    container.appendChild(span);
  });
}

function toggleCategory(el, cat) {
  if (selectedCategories.has(cat)) {
    selectedCategories.delete(cat);
    el.classList.remove('selected');
  } else {
    selectedCategories.add(cat);
    el.classList.add('selected');
  }
}

function addCustomCategory() {
  var input = document.getElementById('nf-cat-custom');
  var val = input.value.trim();
  if (!val) return;
  if (!allCategories.includes(val)) {
    allCategories.push(val);
  }
  selectedCategories.add(val);
  renderCategories();
  input.value = '';
}

async function createFatwa() {
  var btn = document.getElementById('btn-create-fatwa');
  var status = document.getElementById('create-status');
  var wrap = document.getElementById('create-output-wrap');
  var output = document.getElementById('create-output');
  var title = document.getElementById('nf-title').value.trim();
  var date = document.getElementById('nf-date').value.trim();
  var nfEmail = document.getElementById('nf-email').value.trim();
  var youtube = document.getElementById('nf-youtube').value.trim();
  var question = document.getElementById('nf-question').value.trim();
  var answer = document.getElementById('nf-answer').value.trim();
  var answerType = document.getElementById('nf-answer-type').value;

  if (!title) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0641\u062a\u0648\u0649'); return; }
  if (!question) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0646\u0635 \u0627\u0644\u0633\u0624\u0627\u0644'); return; }
  if (!answer) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0646\u0635 \u0627\u0644\u0625\u062c\u0627\u0628\u0629'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> <span>\u062c\u0627\u0631\u064d \u0627\u0644\u0625\u0646\u0634\u0627\u0621...</span>';
  status.innerHTML = '';
  wrap.classList.remove('visible');
  output.className = 'output';
  output.textContent = '';

  try {
    var res = await fetch('/api/create-fatwa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title, date: date, youtube: youtube, question: question, answer: answer,
        email: nfEmail, categories: Array.from(selectedCategories), answer_type: answerType,
      }),
    });
    var data = await res.json();

    output.textContent = data.output || '(no output)';
    wrap.classList.add('visible');

    if (data.success) {
      output.classList.add('success');
      status.innerHTML = '<div class="status-badge success">\u2713 \u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u062a\u0648\u0649 \u0628\u0646\u062c\u0627\u062d: ' + data.filename + '</div>';
      // Auto-delete pending question from KV if this was imported
      var pendingId = document.getElementById('add-modal').dataset.pendingId;
      if (pendingId) {
        fetch('/api/pending-questions/' + pendingId, { method: 'DELETE' }).catch(function() {});
        delete document.getElementById('add-modal').dataset.pendingId;
        loadPendingQuestions();
      }
      document.getElementById('nf-title').value = '';
      document.getElementById('nf-email').value = '';
      document.getElementById('nf-youtube').value = '';
      document.getElementById('nf-question').value = '';
      document.getElementById('nf-answer').value = '';
      document.getElementById('nf-answer-type').value = '';
      selectedCategories.clear();
      loadFatwaMeta();
      loadFatawa().then(function() { renderManageList(document.getElementById('manage-search').value); });
      // Dismiss dialog after short delay so user sees success
      setTimeout(function() { closeAddModal(); }, 800);
    } else {
      output.classList.add('error');
      status.innerHTML = '<div class="status-badge error">\u2717 \u0641\u0634\u0644 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u062a\u0648\u0649</div>';
    }
  } catch (e) {
    output.textContent = e.message;
    wrap.classList.add('visible');
    output.classList.add('error');
    status.innerHTML = '<div class="status-badge error">\u2717 \u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0627\u062a\u0635\u0627\u0644</div>';
  }

  btn.disabled = false;
  btn.innerHTML = '<span>\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u062a\u0648\u0649</span>';
}

function clearCreateResults() {
  document.getElementById('create-status').innerHTML = '';
  document.getElementById('create-output-wrap').classList.remove('visible');
  var output = document.getElementById('create-output');
  output.className = 'output';
  output.textContent = '';
}

// -- Edit modal ---------------------------------------------------
let editCategories = new Set();
let editingId = '';

async function openEditModal(fatwaId) {
  editingId = fatwaId;
  document.getElementById('edit-status').innerHTML = '';
  try {
    var res = await fetch('/api/fatwa/' + fatwaId);
    var data = await res.json();
    document.getElementById('edit-id').value = data.id;
    document.getElementById('edit-title').value = data.title;
    document.getElementById('edit-date').value = data.date;
    document.getElementById('edit-youtube').value = data.youtube;
    toggleTranscriptBtn('edit-youtube', 'btn-edit-transcript');
    document.getElementById('edit-email').value = data.email;
    document.getElementById('edit-question').value = data.question;
    document.getElementById('edit-answer').value = data.answer;
    document.getElementById('edit-answer-type').value = data.answer_type || '';
    document.getElementById('edit-modal-title').textContent = '\u062a\u0639\u062f\u064a\u0644: ' + data.title;

    editCategories = new Set(data.categories || []);
    renderEditCategories();

    document.getElementById('edit-modal').classList.add('open');
  } catch (e) {
    showAlert('\u062e\u0637\u0623 \u0641\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0641\u062a\u0648\u0649: ' + e.message);
  }
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  editingId = '';
}

function renderEditCategories() {
  var container = document.getElementById('edit-categories');
  container.innerHTML = '';
  allCategories.forEach(function(c) {
    var span = document.createElement('span');
    span.className = 'cat-tag' + (editCategories.has(c) ? ' selected' : '');
    span.textContent = c;
    span.addEventListener('click', function() {
      if (editCategories.has(c)) {
        editCategories.delete(c);
        span.classList.remove('selected');
      } else {
        editCategories.add(c);
        span.classList.add('selected');
      }
    });
    container.appendChild(span);
  });
}

function addEditCustomCategory() {
  var input = document.getElementById('edit-cat-custom');
  var val = input.value.trim();
  if (!val) return;
  if (!allCategories.includes(val)) allCategories.push(val);
  editCategories.add(val);
  renderEditCategories();
  input.value = '';
}

async function saveEdit() {
  var btn = document.getElementById('btn-save-edit');
  var status = document.getElementById('edit-status');
  var title = document.getElementById('edit-title').value.trim();
  var date = document.getElementById('edit-date').value.trim();
  var editEmail = document.getElementById('edit-email').value.trim();
  var youtube = document.getElementById('edit-youtube').value.trim();
  var question = document.getElementById('edit-question').value.trim();
  var answer = document.getElementById('edit-answer').value.trim();
  var answerType = document.getElementById('edit-answer-type').value;

  if (!title) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0639\u0646\u0648\u0627\u0646'); return; }
  if (!question) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0633\u0624\u0627\u0644'); return; }
  if (!answer) { showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0625\u062c\u0627\u0628\u0629'); return; }

  btn.disabled = true;
  btn.textContent = '\u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638...';
  status.innerHTML = '';

  try {
    var res = await fetch('/api/fatwa/' + editingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title, date: date, youtube: youtube, question: question, answer: answer,
        email: editEmail, categories: Array.from(editCategories), answer_type: answerType,
      }),
    });
    var data = await res.json();
    if (data.success) {
      status.innerHTML = '<div class="status-badge success">\u2713 \u062a\u0645 \u0627\u0644\u062d\u0641\u0638 \u0628\u0646\u062c\u0627\u062d</div>';
      loadFatawa().then(function() { renderManageList(document.getElementById('manage-search').value); });
      // Dismiss dialog after short delay so user sees success
      setTimeout(function() { closeEditModal(); }, 800);
    } else {
      status.innerHTML = '<div class="status-badge error">\u2717 ' + (data.output || '\u0641\u0634\u0644 \u0627\u0644\u062d\u0641\u0638') + '</div>';
    }
  } catch (e) {
    status.innerHTML = '<div class="status-badge error">\u2717 \u062e\u0637\u0623: ' + e.message + '</div>';
  }
  btn.disabled = false;
  btn.textContent = '\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a';
}

async function confirmDelete() {
  if (!editingId) return;
  var ok = await showConfirm('\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0641\u062a\u0648\u0649\u061f \u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0625\u062c\u0631\u0627\u0621.');
  if (!ok) return;
  deleteFatwa(editingId);
}

async function quickDelete(fatwaId, title) {
  var ok = await showConfirm('\u062d\u0630\u0641 \u0627\u0644\u0641\u062a\u0648\u0649: ' + title + '\u061f \u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0625\u062c\u0631\u0627\u0621.');
  if (!ok) return;
  deleteFatwa(fatwaId);
}

async function deleteFatwa(fatwaId) {
  try {
    var res = await fetch('/api/fatwa/' + fatwaId, { method: 'DELETE' });
    var data = await res.json();
    if (data.success) {
      closeEditModal();
      selectedFatwaId = '';
      selectedFatwaTitle = '';
      selectedFatwaEmail = '';
      loadFatawa().then(function() { renderManageList(document.getElementById('manage-search').value); });
      loadFatwaMeta();
    } else {
      showAlert('\u0641\u0634\u0644 \u0627\u0644\u062d\u0630\u0641: ' + (data.output || ''));
    }
  } catch (e) {
    showAlert('\u062e\u0637\u0623: ' + e.message);
  }
}

// -- Add fatwa modal ----------------------------------------------
function openAddModal() {
  clearCreateResults();
  delete document.getElementById('add-modal').dataset.pendingId;
  document.getElementById('add-modal').classList.add('open');
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
}

// -- Pending questions from KV ------------------------------------
let pendingQuestions = [];

async function loadPendingQuestions() {
  var listEl = document.getElementById('pending-list');
  var countEl = document.getElementById('pending-count');
  var statusEl = document.getElementById('pending-status');
  listEl.innerHTML = '<div class="pq-empty">\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644...</div>';
  statusEl.innerHTML = '';

  try {
    var res = await fetch('/api/pending-questions');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    pendingQuestions = await res.json();
  } catch (e) {
    listEl.innerHTML = '<div class="pq-empty">\u062e\u0637\u0623 \u0641\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0623\u0633\u0626\u0644\u0629: ' + e.message + '</div>';
    countEl.style.display = 'none';
    return;
  }

  if (pendingQuestions.length === 0) {
    listEl.innerHTML = '<div class="pq-empty">\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0633\u0626\u0644\u0629 \u0648\u0627\u0631\u062f\u0629</div>';
    countEl.style.display = 'none';
    return;
  }

  countEl.textContent = pendingQuestions.length;
  countEl.style.display = 'inline';
  renderPendingList();
}

function renderPendingList() {
  var listEl = document.getElementById('pending-list');
  listEl.innerHTML = '';
  pendingQuestions.forEach(function(q) {
    var card = document.createElement('div');
    card.className = 'pq-card';
    card.innerHTML =
      '<div class="pq-card-title">' + escapeHtml(q.title) + '</div>' +
      '<div class="pq-card-msg">' + escapeHtml(q.message) + '</div>' +
      '<div class="pq-card-meta">' +
        '<span>' + escapeHtml(q.name) + '</span>' +
        '<span dir="ltr">' + escapeHtml(q.email) + '</span>' +
        '<span dir="ltr">' + escapeHtml(q.date || '') + '</span>' +
      '</div>' +
      '<div class="pq-card-actions">' +
        '<button class="btn btn-gold pq-import-btn">\u0625\u0646\u0634\u0627\u0621 \u0641\u062a\u0648\u0649</button>' +
        '<button class="btn btn-danger pq-dismiss-btn">\u062d\u0630\u0641</button>' +
      '</div>';
    card.querySelector('.pq-import-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      importPendingQuestion(q);
    });
    card.querySelector('.pq-dismiss-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      dismissPendingQuestion(q.id, q.title);
    });
    listEl.appendChild(card);
  });
}

function importPendingQuestion(q) {
  // Open the Add Fatwa modal pre-filled with the pending question data
  openAddModal();
  document.getElementById('nf-title').value = q.title || '';
  document.getElementById('nf-email').value = q.email || '';
  document.getElementById('nf-question').value = q.message || '';
  document.getElementById('nf-answer').value = '';
  // Store the pending question ID so we can delete it after successful fatwa creation
  document.getElementById('add-modal').dataset.pendingId = q.id;
}

async function dismissPendingQuestion(id, title) {
  var ok = await showConfirm('\u062d\u0630\u0641 \u0627\u0644\u0633\u0624\u0627\u0644: ' + title + '\u061f');
  if (!ok) return;
  try {
    var res = await fetch('/api/pending-questions/' + id, { method: 'DELETE' });
    var data = await res.json();
    if (data.success) {
      loadPendingQuestions();
    } else {
      showAlert('\u0641\u0634\u0644 \u0627\u0644\u062d\u0630\u0641');
    }
  } catch (e) {
    showAlert('\u062e\u0637\u0623: ' + e.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -- Fetch YouTube transcript via youtube-transcript-api ----------
async function fetchTranscript(textareaId, youtubeInputId, answerTypeId) {
  var ytInput = document.getElementById(youtubeInputId);
  var ytUrl = (ytInput ? ytInput.value : '').trim();
  if (!ytUrl) {
    showAlert('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0631\u0627\u0628\u0637 \u064a\u0648\u062a\u064a\u0648\u0628 \u0623\u0648\u0644\u0627\u064b');
    ytInput && ytInput.focus();
    return;
  }

  var textarea = document.getElementById(textareaId);
  var btn = event.currentTarget;
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    var res = await fetch('/api/youtube-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: ytUrl }),
    });
    var data = await res.json();
    if (data.success) {
      textarea.value = data.text;
      // Auto-set answer type to mufarragh
      if (answerTypeId) {
        document.getElementById(answerTypeId).value = '\u0645\u064f\u0641\u0631\u0651\u063a';
      }
    } else {
      showAlert('\u0641\u0634\u0644 \u0627\u0644\u062a\u0641\u0631\u064a\u063a: ' + (data.error || '\u062e\u0637\u0623 \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641'));
    }
  } catch (e) {
    showAlert('\u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0627\u062a\u0635\u0627\u0644: ' + e.message);
  }

  btn.disabled = false;
  btn.innerHTML = origHtml;
}

// -- Init ---------------------------------------------------------
document.getElementById('manage-search').addEventListener('input', filterManageList);
document.getElementById('edit-modal').addEventListener('click', function(e) {
  if (e.target === this) closeEditModal();
});
document.getElementById('add-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAddModal();
});
document.getElementById('notify-modal').addEventListener('click', function(e) {
  if (e.target === this) closeNotifyModal();
});

loadFatawa().then(function() { renderManageList(); });
loadFatwaMeta();
loadPendingQuestions();

// -- Wire up YouTube input listeners for transcript button toggle -----
document.getElementById('nf-youtube').addEventListener('input', function() {
  toggleTranscriptBtn('nf-youtube', 'btn-nf-transcript');
});
document.getElementById('edit-youtube').addEventListener('input', function() {
  toggleTranscriptBtn('edit-youtube', 'btn-edit-transcript');
});
