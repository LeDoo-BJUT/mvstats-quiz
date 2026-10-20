(function () {
  'use strict';

  var STORAGE_KEY = 'mvstats-quiz-v1';
  var TYPE_LABEL = {
    single: '单选',
    multi: '多选（全对才得分）',
    judge: '判断',
    blank: '填空',
    short: '简答',
    case: '案例分析'
  };
  var OBJECTIVE = { single: 1, multi: 1, judge: 1, blank: 1 };

  var bank = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK.slice() : [];
  var bankMap = {};
  bank.forEach(function (q) { bankMap[q.id] = q; });

  var state = loadState();
  var filtered = [];
  var currentAnswered = false;
  var lastMissedIds = []; // objective wrongs from latest 交卷

  function defaultState() {
    return {
      version: 2,
      favorites: [],
      wrongIds: [],
      chapter: 'all',
      type: 'all',
      shuffle: false,
      mode: 'all', // all | favorites | wrong | paper
      order: [],
      index: 0,
      answers: {},
      scoreCorrect: 0,
      scoreTotal: 0,
      paperIds: null,
      sessionEnded: false
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var d = defaultState();
      // migrate v1 flat progress
      if (s && typeof s === 'object') {
        Object.keys(d).forEach(function (k) {
          if (s[k] !== undefined) d[k] = s[k];
        });
        // nested progress/settings forms
        if (s.progress && typeof s.progress === 'object') {
          Object.keys(s.progress).forEach(function (k) {
            if (d[k] !== undefined) d[k] = s.progress[k];
          });
        }
        if (s.settings && typeof s.settings === 'object' && s.settings.shuffle != null) {
          d.shuffle = !!s.settings.shuffle;
        }
        if (!Array.isArray(d.favorites)) d.favorites = [];
        if (!Array.isArray(d.wrongIds)) d.wrongIds = [];
        d.version = 2;
      }
      return d;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function isFavorite(id) {
    return state.favorites.indexOf(id) >= 0;
  }

  function toggleFavorite(id) {
    var i = state.favorites.indexOf(id);
    if (i >= 0) state.favorites.splice(i, 1);
    else state.favorites.push(id);
    saveState();
    updateCountsUI();
  }

  function addWrong(id) {
    if (state.wrongIds.indexOf(id) < 0) {
      state.wrongIds.push(id);
      saveState();
      updateCountsUI();
    }
  }

  function removeWrong(id) {
    var i = state.wrongIds.indexOf(id);
    if (i >= 0) {
      state.wrongIds.splice(i, 1);
      saveState();
      updateCountsUI();
    }
  }

  function isObjective(q) {
    return !!(q && OBJECTIVE[q.type]);
  }

  function countByType() {
    var c = { single: 0, multi: 0, judge: 0, blank: 0, short: 0, case: 0 };
    bank.forEach(function (q) { if (c[q.type] != null) c[q.type]++; });
    return c;
  }

  function updateCountsUI() {
    var favN = state.favorites.length;
    var wrongN = state.wrongIds.length;
    var hc = document.getElementById('header-counts');
    if (hc) {
      hc.innerHTML =
        '<span class="pill fav">收藏 ' + favN + '</span>' +
        '<span class="pill wrong">错题 ' + wrongN + '</span>';
    }
    var cf = document.getElementById('chip-fav-n');
    var cw = document.getElementById('chip-wrong-n');
    if (cf) cf.textContent = String(favN);
    if (cw) cw.textContent = String(wrongN);
  }

  function renderHomeStats() {
    var c = countByType();
    var labels = [
      ['单选', c.single], ['多选', c.multi], ['判断', c.judge],
      ['填空', c.blank], ['简答', c.short], ['案例', c.case]
    ];
    var html = labels.map(function (x) {
      return '<div class="stat"><div class="n">' + x[1] + '</div><div class="l">' + x[0] + '</div></div>';
    }).join('');
    html += '<div class="stat"><div class="n">' + bank.length + '</div><div class="l">合计</div></div>';
    html += '<div class="stat fav-stat"><div class="n">' + state.favorites.length + '</div><div class="l">收藏</div></div>';
    html += '<div class="stat wrong-stat"><div class="n">' + state.wrongIds.length + '</div><div class="l">错题</div></div>';
    document.getElementById('home-stats').innerHTML = html;
    updateCountsUI();
    syncModeChips();
    updatePaperPoolHint();
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var sa = a.slice().sort().join('|');
    var sb = b.slice().sort().join('|');
    return sa === sb;
  }

  function basePool() {
    if (state.mode === 'favorites') {
      return bank.filter(function (q) { return isFavorite(q.id); });
    }
    if (state.mode === 'wrong') {
      return bank.filter(function (q) { return state.wrongIds.indexOf(q.id) >= 0; });
    }
    if (state.mode === 'paper' && Array.isArray(state.paperIds) && state.paperIds.length) {
      return state.paperIds.map(function (id) { return bankMap[id]; }).filter(Boolean);
    }
    // all
    return bank.filter(function (q) {
      if (state.chapter !== 'all' && String(q.chapter) !== String(state.chapter)) return false;
      if (state.type !== 'all' && q.type !== state.type) return false;
      return true;
    });
  }

  function rebuildFilter(resetIndex) {
    var pool = basePool();
    var ids = pool.map(function (q) { return q.id; });

    if (state.mode === 'paper' && Array.isArray(state.paperIds) && state.paperIds.length) {
      // paper keeps its own order; reshuffle only when restart + shuffle
      if (state.shuffle && (resetIndex || !state.order.length || !sameSet(state.order, ids))) {
        state.order = shuffle(ids.slice());
      } else if (!state.order.length || !sameSet(state.order, ids)) {
        state.order = ids.slice();
      }
    } else if (state.shuffle) {
      if (!state.order.length || !sameSet(state.order, ids) || resetIndex) {
        state.order = shuffle(ids.slice());
      }
    } else {
      state.order = ids.slice();
    }

    if (resetIndex || state.index >= state.order.length) state.index = 0;

    var map = {};
    pool.forEach(function (q) { map[q.id] = q; });
    filtered = state.order.map(function (id) { return map[id]; }).filter(Boolean);
    saveState();
  }

  function currentQ() {
    return filtered[state.index] || null;
  }

  function sessionScore() {
    var correct = 0;
    var answered = 0;
    filtered.forEach(function (q) {
      if (!isObjective(q)) return;
      var a = state.answers[q.id];
      if (a && a.submitted && a.grade && (a.grade.correct === true || a.grade.correct === false)) {
        answered += 1;
        if (a.grade.correct) correct += 1;
      }
    });
    return { correct: correct, answered: answered };
  }

  function updateProgress() {
    var n = filtered.length;
    var i = n ? state.index + 1 : 0;
    document.getElementById('progress-text').textContent = i + ' / ' + n;
    var sc = sessionScore();
    var rate = sc.answered ? Math.round((sc.correct / sc.answered) * 100) + '%' : '—';
    document.getElementById('score-text').textContent =
      '答对 ' + sc.correct + ' / 已答 ' + sc.answered + ' · 正确率 ' + rate;
    document.getElementById('progress-fill').style.width = (n ? Math.round((i / n) * 100) : 0) + '%';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncate(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    return s.slice(0, n) + '…';
  }

  function emptyStateHtml(mode) {
    if (mode === 'favorites') {
      return '<div class="empty-state"><div class="icon">♡</div>' +
        '<p><strong>暂无收藏</strong></p>' +
        '<p>在题目页点击「收藏」心形按钮，即可加入收藏本。</p></div>';
    }
    if (mode === 'wrong') {
      return '<div class="empty-state"><div class="icon">✓</div>' +
        '<p><strong>错题本为空</strong></p>' +
        '<p>客观题答错会自动记入；简答/案例可自行「记入错题」。答对后自动移出。</p></div>';
    }
    if (mode === 'paper') {
      return '<div class="empty-state"><div class="icon">卷</div>' +
        '<p><strong>尚未组卷</strong></p>' +
        '<p>请返回首页，在「抽题组卷」中选择章节与题量后生成。</p></div>';
    }
    return '<div class="empty-state"><p>当前筛选下没有题目，请调整章节或题型。</p></div>';
  }

  function renderQuestion() {
    var area = document.getElementById('question-area');
    var summary = document.getElementById('summary-card');
    var practiceCard = document.getElementById('practice-card');

    if (state.sessionEnded) {
      practiceCard.classList.add('hidden');
      summary.classList.remove('hidden');
      return;
    }
    summary.classList.add('hidden');
    practiceCard.classList.remove('hidden');

    currentAnswered = false;
    document.getElementById('btn-submit').disabled = false;
    document.getElementById('btn-prev').disabled = state.index <= 0;
    document.getElementById('btn-next').disabled = !filtered.length || state.index >= filtered.length - 1;

    if (!filtered.length) {
      area.innerHTML = emptyStateHtml(state.mode);
      updateProgress();
      document.getElementById('btn-submit').disabled = true;
      return;
    }

    var q = currentQ();
    if (!q) {
      area.innerHTML = emptyStateHtml(state.mode);
      updateProgress();
      return;
    }

    var saved = state.answers[q.id];
    var favOn = isFavorite(q.id);
    var html = '';
    html += '<div class="q-head">';
    html += '<span class="q-type">' + escapeHtml(TYPE_LABEL[q.type] || q.type) +
      ' · 第' + q.chapter + '章</span>';
    html += '<button type="button" class="fav-btn' + (favOn ? ' on' : '') + '" id="btn-fav" aria-pressed="' +
      (favOn ? 'true' : 'false') + '"><span class="heart">' + (favOn ? '♥' : '♡') +
      '</span> ' + (favOn ? '已收藏' : '收藏') + '</button>';
    html += '</div>';
    html += '<p class="stem">' + escapeHtml(q.stem) + '</p>';

    if (q.type === 'single' || q.type === 'multi') {
      html += '<div class="options" id="opts">';
      (q.options || []).forEach(function (opt) {
        var letter = opt.charAt(0);
        var inputType = q.type === 'multi' ? 'checkbox' : 'radio';
        var checked = false;
        if (saved && saved.choice != null) {
          if (q.type === 'multi') checked = (saved.choice || []).indexOf(letter) >= 0;
          else checked = saved.choice === letter;
        }
        html += '<label class="opt' + (checked ? ' selected' : '') + '" data-letter="' + letter + '">' +
          '<input type="' + inputType + '" name="opt" value="' + letter + '"' +
          (checked ? ' checked' : '') + ' />' +
          '<span>' + escapeHtml(opt) + '</span></label>';
      });
      html += '</div>';
    } else if (q.type === 'judge') {
      html += '<div class="options" id="opts">';
      [['true', '正确'], ['false', '错误']].forEach(function (pair) {
        var checked = saved && String(saved.choice) === pair[0];
        // judge stores boolean in choice after submit; also accept pre-submit string
        if (saved && typeof saved.choice === 'boolean') {
          checked = (saved.choice === true && pair[0] === 'true') ||
            (saved.choice === false && pair[0] === 'false');
        }
        html += '<label class="opt' + (checked ? ' selected' : '') + '">' +
          '<input type="radio" name="opt" value="' + pair[0] + '"' +
          (checked ? ' checked' : '') + ' />' +
          '<span>' + pair[1] + '</span></label>';
      });
      html += '</div>';
    } else if (q.type === 'blank') {
      var v = saved && saved.text != null ? saved.text : '';
      html += '<input type="text" id="blank-input" placeholder="请输入答案" value="' + escapeHtml(v) + '" />';
    } else {
      var tv = saved && saved.text != null ? saved.text : '';
      html += '<textarea id="text-input" placeholder="请用自己的话作答">' + escapeHtml(tv) + '</textarea>';
    }

    html += '<div id="reveal" class="reveal' + (saved && saved.submitted ? '' : ' hidden') + '"></div>';
    area.innerHTML = html;

    var favBtn = document.getElementById('btn-fav');
    if (favBtn) {
      favBtn.addEventListener('click', function () {
        toggleFavorite(q.id);
        var on = isFavorite(q.id);
        favBtn.classList.toggle('on', on);
        favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        favBtn.innerHTML = '<span class="heart">' + (on ? '♥' : '♡') + '</span> ' +
          (on ? '已收藏' : '收藏');
        // if in favorites mode and unfavorited, rebuild
        if (state.mode === 'favorites' && !on) {
          rebuildFilter(false);
          if (state.index >= filtered.length) state.index = Math.max(0, filtered.length - 1);
          saveState();
          renderQuestion();
        }
      });
    }

    if (saved && saved.submitted) {
      currentAnswered = true;
      document.getElementById('btn-submit').disabled = true;
      showReveal(q, saved, true);
    }

    bindOptionClicks();
    updateProgress();
  }

  function bindOptionClicks() {
    var opts = document.querySelectorAll('#opts .opt');
    opts.forEach(function (el) {
      el.addEventListener('click', function () {
        if (currentAnswered) return;
        var input = el.querySelector('input');
        if (!input) return;
        if (input.type === 'radio') {
          opts.forEach(function (o) { o.classList.remove('selected'); });
          el.classList.add('selected');
          input.checked = true;
        } else {
          setTimeout(function () {
            if (input.checked) el.classList.add('selected');
            else el.classList.remove('selected');
          }, 0);
        }
      });
    });
  }

  function collectResponse(q) {
    if (q.type === 'single') {
      var r = document.querySelector('input[name="opt"]:checked');
      return r ? r.value : null;
    }
    if (q.type === 'multi') {
      var boxes = document.querySelectorAll('input[name="opt"]:checked');
      return Array.prototype.map.call(boxes, function (b) { return b.value; }).sort();
    }
    if (q.type === 'judge') {
      var j = document.querySelector('input[name="opt"]:checked');
      if (!j) return null;
      return j.value === 'true';
    }
    if (q.type === 'blank') {
      var bi = document.getElementById('blank-input');
      return bi ? bi.value : '';
    }
    var ti = document.getElementById('text-input');
    return ti ? ti.value : '';
  }

  function normBlank(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  function grade(q, response) {
    if (q.type === 'single') {
      return { correct: response === q.answer, expected: q.answer };
    }
    if (q.type === 'multi') {
      var exp = (q.answer || []).slice().sort();
      var got = (response || []).slice().sort();
      var ok = exp.length === got.length && exp.every(function (x, i) { return x === got[i]; });
      return { correct: ok, expected: exp.join('') };
    }
    if (q.type === 'judge') {
      return { correct: response === q.answer, expected: q.answer ? '正确' : '错误' };
    }
    if (q.type === 'blank') {
      var candidates = [].concat(q.answer || [], q.accept || []);
      var got = normBlank(response);
      var ok = candidates.some(function (c) { return normBlank(c) === got; });
      return { correct: ok && got.length > 0, expected: (q.answer || []).join(' / ') };
    }
    return { correct: null, expected: q.answer };
  }

  function showReveal(q, record, fromSaved) {
    var el = document.getElementById('reveal');
    if (!el) return;
    el.classList.remove('hidden');
    var html = '';
    var g = record.grade || {};

    if (q.type === 'short' || q.type === 'case') {
      html += '<div class="side-by-side">';
      html += '<div class="box"><strong>你的作答</strong><br>' + escapeHtml(record.text || '（未作答）') + '</div>';
      html += '<div class="box"><strong>参考答案</strong><br>' +
        escapeHtml(typeof q.answer === 'string' ? q.answer : JSON.stringify(q.answer)) + '</div>';
      html += '</div>';
      if (q.type === 'short' && q.pptQuote) {
        html += '<div class="box"><div class="quote-label">课件原话</div>' + escapeHtml(q.pptQuote) + '</div>';
      }
      var inWrong = state.wrongIds.indexOf(q.id) >= 0;
      html += '<div class="self-mark" id="self-mark">';
      html += '<span class="hint">主观题不自动判分，可自行记入错题本：</span>';
      if (inWrong) {
        html += '<button type="button" class="btn secondary" id="btn-mark-mastered">已掌握（移出错题）</button>';
      } else {
        html += '<button type="button" class="btn warn" id="btn-mark-wrong">记入错题</button>';
        html += '<button type="button" class="btn ghost" id="btn-mark-skip">跳过</button>';
      }
      html += '</div>';
    } else {
      if (g.correct) html += '<div class="verdict ok">回答正确</div>';
      else html += '<div class="verdict bad">回答不正确</div>';
      if (q.type === 'blank' && !g.correct) {
        html += '<div class="box">期望答案：' + escapeHtml(g.expected) + '</div>';
      }
      if (q.type === 'multi') {
        html += '<p class="src">多选为全对得分（须选齐全部正确项且无多余项）。</p>';
      }
      if (q.type === 'single' || q.type === 'multi') {
        var correctSet = q.type === 'multi' ? q.answer : [q.answer];
        document.querySelectorAll('#opts .opt').forEach(function (lab) {
          var letter = lab.getAttribute('data-letter') || (lab.querySelector('input') || {}).value;
          lab.classList.remove('correct', 'wrong');
          if (correctSet.indexOf(letter) >= 0) lab.classList.add('correct');
          else if (lab.classList.contains('selected')) lab.classList.add('wrong');
        });
      }
      if (q.type === 'judge') {
        document.querySelectorAll('#opts .opt').forEach(function (lab) {
          var v = lab.querySelector('input').value === 'true';
          lab.classList.remove('correct', 'wrong');
          if (v === q.answer) lab.classList.add('correct');
          else if (lab.classList.contains('selected')) lab.classList.add('wrong');
        });
      }
    }

    if (q.explanation) {
      html += '<div class="box"><strong>解析</strong><br>' + escapeHtml(q.explanation) + '</div>';
    }
    html += '<p class="src">来源：' + escapeHtml(q.sourceFile) + ' · ' + escapeHtml(q.sourceLocator) + '</p>';
    el.innerHTML = html;

    var markWrong = document.getElementById('btn-mark-wrong');
    var markSkip = document.getElementById('btn-mark-skip');
    var markMastered = document.getElementById('btn-mark-mastered');
    if (markWrong) {
      markWrong.addEventListener('click', function () {
        addWrong(q.id);
        showReveal(q, record, fromSaved);
      });
    }
    if (markSkip) {
      markSkip.addEventListener('click', function () {
        var sm = document.getElementById('self-mark');
        if (sm) sm.innerHTML = '<span class="hint">已跳过，未记入错题本。</span>';
      });
    }
    if (markMastered) {
      markMastered.addEventListener('click', function () {
        removeWrong(q.id);
        showReveal(q, record, fromSaved);
        if (state.mode === 'wrong') {
          rebuildFilter(false);
          if (state.index >= filtered.length) state.index = Math.max(0, filtered.length - 1);
          saveState();
          renderQuestion();
        }
      });
    }
  }

  function onSubmit() {
    var q = currentQ();
    if (!q || currentAnswered) return;
    var response = collectResponse(q);
    if (q.type === 'single' || q.type === 'multi' || q.type === 'judge') {
      if (response == null || (Array.isArray(response) && !response.length)) {
        alert('请先选择答案');
        return;
      }
    }
    if (q.type === 'blank' && !String(response || '').trim()) {
      alert('请填写答案');
      return;
    }
    if ((q.type === 'short' || q.type === 'case') && !String(response || '').trim()) {
      alert('请先作答');
      return;
    }

    var already = state.answers[q.id] && state.answers[q.id].submitted;
    var g = grade(q, response);
    var record = {
      submitted: true,
      choice: (q.type === 'single' || q.type === 'multi' || q.type === 'judge') ? response : null,
      text: (q.type === 'blank' || q.type === 'short' || q.type === 'case') ? response : null,
      grade: g
    };
    state.answers[q.id] = record;

    // wrong book for objective
    if (isObjective(q) && g.correct === true) {
      removeWrong(q.id);
    } else if (isObjective(q) && g.correct === false) {
      addWrong(q.id);
    }

    if (!already) {
      if (g.correct === true || g.correct === false) {
        state.scoreTotal += 1;
        if (g.correct) state.scoreCorrect += 1;
      }
    }

    currentAnswered = true;
    document.getElementById('btn-submit').disabled = true;
    saveState();
    showReveal(q, record, false);
    updateProgress();

    // auto-show summary when last question answered
    if (state.index >= filtered.length - 1 && filtered.length > 0) {
      // leave user on last question; they can hit 交卷
    }
  }

  function go(delta) {
    if (!filtered.length) return;
    state.index = Math.max(0, Math.min(filtered.length - 1, state.index + delta));
    saveState();
    renderQuestion();
  }

  function syncModeChips() {
    var mode = state.mode || 'all';
    document.querySelectorAll('.mode-chips .chip').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-mode') === mode);
    });
    var paperPanel = document.getElementById('paper-panel');
    var enterRow = document.getElementById('home-enter-row');
    if (paperPanel && enterRow) {
      if (mode === 'paper' && !document.getElementById('home').classList.contains('hidden')) {
        paperPanel.classList.remove('hidden');
        enterRow.classList.add('hidden');
      } else {
        paperPanel.classList.add('hidden');
        if (!document.getElementById('home').classList.contains('hidden')) {
          enterRow.classList.remove('hidden');
        }
      }
    }
    // chapter/type filters only for 全部练习
    var showFilters = mode === 'all';
    var chWrap = document.getElementById('filter-ch-wrap');
    var tyWrap = document.getElementById('filter-type-wrap');
    if (chWrap) chWrap.classList.toggle('hidden', !showFilters);
    if (tyWrap) tyWrap.classList.toggle('hidden', !showFilters);
  }

  function setMode(mode, enterPractice) {
    state.mode = mode;
    state.sessionEnded = false;
    if (mode !== 'paper') {
      // keep paperIds for returning to paper chip, but clear when switching away optionally
    }
    if (mode === 'all' || mode === 'favorites' || mode === 'wrong') {
      // ok
    }
    state.order = [];
    saveState();
    syncModeChips();
    updateCountsUI();
    if (enterPractice) {
      showPractice();
    } else {
      renderHomeStats();
    }
  }

  function showPractice() {
    document.getElementById('home').classList.add('hidden');
    document.getElementById('practice').classList.remove('hidden');
    document.getElementById('filter-ch').value = state.chapter;
    document.getElementById('filter-type').value = state.type;
    document.getElementById('toggle-shuffle').checked = !!state.shuffle;
    state.sessionEnded = false;
    syncModeChips();
    rebuildFilter(false);
    renderQuestion();
  }

  function showHome() {
    document.getElementById('practice').classList.add('hidden');
    document.getElementById('home').classList.remove('hidden');
    document.getElementById('summary-card').classList.add('hidden');
    state.sessionEnded = false;
    saveState();
    renderHomeStats();
    syncModeChips();
  }

  function restart() {
    state.answers = {};
    state.scoreCorrect = 0;
    state.scoreTotal = 0;
    state.index = 0;
    state.order = [];
    state.sessionEnded = false;
    lastMissedIds = [];
    rebuildFilter(true);
    document.getElementById('summary-card').classList.add('hidden');
    document.getElementById('practice-card').classList.remove('hidden');
    renderQuestion();
  }

  function finishPaper() {
    // Grade all answered objective; unanswered objective shown separately
    var objTotal = 0;
    var correct = 0;
    var answeredObj = 0;
    var unanswered = [];
    var wrongList = [];
    var subjAnswered = 0;
    var subjTotal = 0;

    filtered.forEach(function (q, idx) {
      var a = state.answers[q.id];
      if (isObjective(q)) {
        objTotal += 1;
        if (a && a.submitted && a.grade && (a.grade.correct === true || a.grade.correct === false)) {
          answeredObj += 1;
          if (a.grade.correct) correct += 1;
          else {
            wrongList.push({ q: q, idx: idx, tag: '答错' });
            addWrong(q.id);
          }
        } else {
          unanswered.push({ q: q, idx: idx, tag: '未答' });
          // unanswered does not auto-add to wrong book unless we want — leave as 未答 only
        }
      } else {
        subjTotal += 1;
        if (a && a.submitted) subjAnswered += 1;
      }
    });

    lastMissedIds = wrongList.map(function (x) { return x.q.id; });

    state.sessionEnded = true;
    saveState();

    var rate = objTotal ? Math.round((correct / objTotal) * 100) + '%' : '—';
    var body = document.getElementById('summary-body');
    var html = '';
    html += '<div class="summary-stats">';
    html += '<div class="stat"><div class="n">' + correct + '</div><div class="l">答对</div></div>';
    html += '<div class="stat"><div class="n">' + answeredObj + '</div><div class="l">已答客观</div></div>';
    html += '<div class="stat"><div class="n">' + unanswered.length + '</div><div class="l">未答客观</div></div>';
    html += '<div class="stat"><div class="n">' + objTotal + '</div><div class="l">客观题总数</div></div>';
    html += '<div class="stat"><div class="n">' + rate + '</div><div class="l">正确率</div></div>';
    html += '<div class="stat"><div class="n">' + subjAnswered + '/' + subjTotal + '</div><div class="l">主观作答</div></div>';
    html += '</div>';
    html += '<p class="hint">正确率 = 答对 / 本场客观题总数（未答不计入答对）。主观题不计入正确率。</p>';

    if (wrongList.length) {
      html += '<div class="summary-section-title">答错题目</div><ul class="wrong-list">';
      wrongList.forEach(function (item) {
        html += '<li><button type="button" class="q-link" data-idx="' + item.idx + '">' +
          escapeHtml(truncate(item.q.stem, 48)) + '</button>' +
          '<span class="tag">' + escapeHtml(TYPE_LABEL[item.q.type] || item.q.type) +
          ' · 第' + item.q.chapter + '章 · ' + item.tag + '</span></li>';
      });
      html += '</ul>';
    }
    if (unanswered.length) {
      html += '<div class="summary-section-title">未答客观题</div><ul class="wrong-list">';
      unanswered.forEach(function (item) {
        html += '<li><button type="button" class="q-link" data-idx="' + item.idx + '">' +
          escapeHtml(truncate(item.q.stem, 48)) + '</button>' +
          '<span class="tag">' + escapeHtml(TYPE_LABEL[item.q.type] || item.q.type) +
          ' · 第' + item.q.chapter + '章 · 未答</span></li>';
      });
      html += '</ul>';
    }
    if (!wrongList.length && !unanswered.length && objTotal > 0) {
      html += '<p class="hint" style="margin-top:0.75rem;color:var(--ok);font-weight:600;">本场客观题全部正确，真棒！</p>';
    }

    body.innerHTML = html;
    document.getElementById('practice-card').classList.add('hidden');
    document.getElementById('summary-card').classList.remove('hidden');

    body.querySelectorAll('.q-link').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        state.sessionEnded = false;
        state.index = idx;
        saveState();
        document.getElementById('summary-card').classList.add('hidden');
        document.getElementById('practice-card').classList.remove('hidden');
        renderQuestion();
      });
    });

    var retryWrongBtn = document.getElementById('btn-retry-wrong');
    if (retryWrongBtn) {
      retryWrongBtn.disabled = !lastMissedIds.length;
    }
  }

  /* —— 抽题组卷 —— */
  function getPaperChapterFilter() {
    var allBox = document.getElementById('paper-ch-all');
    if (allBox && allBox.checked) return 'all';
    var selected = [];
    document.querySelectorAll('.paper-ch:checked').forEach(function (el) {
      selected.push(el.value);
    });
    return selected.length ? selected : 'all';
  }

  function paperPool() {
    var chapters = getPaperChapterFilter();
    var type = document.getElementById('paper-type').value;
    return bank.filter(function (q) {
      if (chapters !== 'all') {
        if (chapters.indexOf(String(q.chapter)) < 0) return false;
      }
      if (type !== 'all' && q.type !== type) return false;
      return true;
    });
  }

  function updatePaperPoolHint() {
    var pool = paperPool();
    var hint = document.getElementById('paper-pool-hint');
    var nInput = document.getElementById('paper-n');
    if (hint) hint.textContent = '可选池：' + pool.length + ' 题';
    if (nInput) {
      nInput.max = Math.max(1, pool.length);
      var v = parseInt(nInput.value, 10) || 20;
      if (pool.length && v > pool.length) nInput.value = pool.length;
    }
  }

  function sampleProportional(pool, n) {
    if (pool.length <= n) return shuffle(pool.slice());
    var byType = {};
    pool.forEach(function (q) {
      if (!byType[q.type]) byType[q.type] = [];
      byType[q.type].push(q);
    });
    var types = Object.keys(byType);
    var total = pool.length;
    var alloc = {};
    var assigned = 0;
    types.forEach(function (t, i) {
      if (i === types.length - 1) {
        alloc[t] = Math.min(n - assigned, byType[t].length);
      } else {
        var share = Math.round((byType[t].length / total) * n);
        alloc[t] = Math.min(share, byType[t].length);
        assigned += alloc[t];
      }
    });
    // fix over/under against capacity
    var sum = types.reduce(function (a, t) { return a + alloc[t]; }, 0);
    while (sum > n) {
      var richest = types.slice().sort(function (a, b) { return alloc[b] - alloc[a]; })[0];
      if (alloc[richest] > 0) { alloc[richest]--; sum--; }
      else break;
    }
    while (sum < n) {
      var room = types.filter(function (t) { return alloc[t] < byType[t].length; });
      if (!room.length) break;
      var pick = room[Math.floor(Math.random() * room.length)];
      alloc[pick]++;
      sum++;
    }
    var out = [];
    types.forEach(function (t) {
      var shuffled = shuffle(byType[t].slice());
      out = out.concat(shuffled.slice(0, alloc[t]));
    });
    return shuffle(out);
  }

  function startPaper() {
    var pool = paperPool();
    if (!pool.length) {
      alert('当前筛选下没有题目，请调整章节或题型。');
      return;
    }
    var n = parseInt(document.getElementById('paper-n').value, 10) || 20;
    n = Math.max(1, Math.min(n, pool.length));
    var proportional = document.getElementById('paper-proportional').checked;
    var picked = proportional ? sampleProportional(pool, n) : shuffle(pool.slice()).slice(0, n);
    // ensure shuffled paper order
    picked = shuffle(picked);

    state.mode = 'paper';
    state.paperIds = picked.map(function (q) { return q.id; });
    state.answers = {};
    state.scoreCorrect = 0;
    state.scoreTotal = 0;
    state.index = 0;
    state.order = state.paperIds.slice();
    state.shuffle = true;
    state.sessionEnded = false;
    lastMissedIds = [];
    saveState();
    showPractice();
  }

  // events
  document.getElementById('btn-enter').addEventListener('click', function () {
    if (state.mode === 'paper' && (!state.paperIds || !state.paperIds.length)) {
      // fall back to all if no paper yet
      state.mode = 'all';
    }
    showPractice();
  });
  document.getElementById('btn-home').addEventListener('click', showHome);
  document.getElementById('btn-summary-home').addEventListener('click', showHome);
  document.getElementById('btn-submit').addEventListener('click', onSubmit);
  document.getElementById('btn-next').addEventListener('click', function () { go(1); });
  document.getElementById('btn-prev').addEventListener('click', function () { go(-1); });
  document.getElementById('btn-restart').addEventListener('click', function () {
    if (confirm('确定重新开始当前练习进度吗？（收藏与错题本不受影响）')) restart();
  });
  document.getElementById('btn-finish').addEventListener('click', function () {
    if (!filtered.length) {
      alert('当前没有题目可交卷。');
      return;
    }
    if (confirm('确定交卷？将对当前场次客观题统计正确率，并列出答错与未答。')) {
      finishPaper();
    }
  });
  document.getElementById('btn-retry').addEventListener('click', function () {
    restart();
  });
  document.getElementById('btn-retry-wrong').addEventListener('click', function () {
    if (!lastMissedIds.length) {
      alert('本场没有答错的客观题。');
      return;
    }
    // ensure they are in wrong book, enter wrong mode filtered to session misses ideally
    // Enter wrong-book mode (all wrongIds); session misses are already added
    state.mode = 'wrong';
    state.answers = {};
    state.scoreCorrect = 0;
    state.scoreTotal = 0;
    state.index = 0;
    state.order = [];
    state.paperIds = null;
    state.sessionEnded = false;
    // Prefer practicing just the ones missed this session if still in wrongIds
    // Temporarily use paperIds-like subset via wrong mode: rebuild from wrongIds
    // Override: set mode paper with missed ids for a focused retry
    state.mode = 'paper';
    state.paperIds = lastMissedIds.slice();
    state.order = shuffle(state.paperIds.slice());
    state.shuffle = true;
    saveState();
    syncModeChips();
    rebuildFilter(true);
    document.getElementById('summary-card').classList.add('hidden');
    document.getElementById('practice-card').classList.remove('hidden');
    renderQuestion();
  });

  document.getElementById('filter-ch').addEventListener('change', function (e) {
    state.chapter = e.target.value;
    state.order = [];
    rebuildFilter(true);
    renderQuestion();
  });
  document.getElementById('filter-type').addEventListener('change', function (e) {
    state.type = e.target.value;
    state.order = [];
    rebuildFilter(true);
    renderQuestion();
  });
  document.getElementById('toggle-shuffle').addEventListener('change', function (e) {
    state.shuffle = e.target.checked;
    state.order = [];
    rebuildFilter(true);
    renderQuestion();
  });

  function onModeChipClick(e) {
    var btn = e.currentTarget;
    var mode = btn.getAttribute('data-mode');
    if (!mode) return;
    if (mode === 'paper') {
      // on home: show panel; if already in practice with paper, stay
      var onHome = !document.getElementById('home').classList.contains('hidden');
      if (onHome) {
        state.mode = 'paper';
        saveState();
        syncModeChips();
        return;
      }
      // from practice: go home to configure if no paper
      if (!state.paperIds || !state.paperIds.length) {
        showHome();
        state.mode = 'paper';
        saveState();
        syncModeChips();
        return;
      }
      setMode('paper', true);
      return;
    }
    var enter = document.getElementById('home').classList.contains('hidden');
    // from home chips: set mode and optionally enter
    if (!enter) {
      state.mode = mode;
      saveState();
      syncModeChips();
      // favorites/wrong/all — update enter button label? keep 进入练习
      return;
    }
    setMode(mode, true);
  }

  document.querySelectorAll('#home-modes .chip, #practice-modes .chip').forEach(function (el) {
    el.addEventListener('click', onModeChipClick);
  });

  // On home: clicking 进入练习 uses current mode
  // Wire paper chapter checkboxes
  var paperAll = document.getElementById('paper-ch-all');
  if (paperAll) {
    paperAll.addEventListener('change', function () {
      if (paperAll.checked) {
        document.querySelectorAll('.paper-ch').forEach(function (c) { c.checked = false; });
      }
      updatePaperPoolHint();
    });
  }
  document.querySelectorAll('.paper-ch').forEach(function (c) {
    c.addEventListener('change', function () {
      if (c.checked && paperAll) paperAll.checked = false;
      var any = false;
      document.querySelectorAll('.paper-ch:checked').forEach(function () { any = true; });
      if (!any && paperAll) paperAll.checked = true;
      updatePaperPoolHint();
    });
  });
  document.getElementById('paper-type').addEventListener('change', updatePaperPoolHint);
  document.getElementById('paper-n').addEventListener('input', updatePaperPoolHint);
  document.getElementById('btn-start-paper').addEventListener('click', startPaper);

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
    if (document.getElementById('practice').classList.contains('hidden')) return;
    if (state.sessionEnded) return;

    if (!typing && e.key >= '1' && e.key <= '5') {
      var opts = document.querySelectorAll('#opts input');
      var idx = parseInt(e.key, 10) - 1;
      if (opts[idx] && !currentAnswered) {
        var input = opts[idx];
        if (input.type === 'radio') {
          input.checked = true;
          document.querySelectorAll('#opts .opt').forEach(function (o) { o.classList.remove('selected'); });
          input.closest('.opt').classList.add('selected');
        } else {
          input.checked = !input.checked;
          input.closest('.opt').classList.toggle('selected', input.checked);
        }
      }
      return;
    }
    if (e.key === 'Enter' && !typing) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (!typing && e.key === 'ArrowRight') { go(1); }
    if (!typing && e.key === 'ArrowLeft') { go(-1); }
  });

  // Fix duplicate enter: re-bind cleanly
  // The first listener already calls showPractice. Enhance enter to respect mode.
  // Override by replacing — remove duplicate empty listener above by making enter smart:

  renderHomeStats();
  syncModeChips();
})();
