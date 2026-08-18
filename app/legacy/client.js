/* RankedSat local test client. Vanilla JS, no build step.
   The server is authoritative: this file never sees correct answers or rationales
   until the post-match reveal. */
(function () {
  'use strict';

  // ---------- private beta gate ----------
  // Access code (if the server has RANKEDSAT_ACCESS_CODE set) lives only in
  // localStorage and is sent per-request; it is never embedded in this file.
  function getStoredCode() { return localStorage.getItem('rankedsat.accessCode') || ''; }
  function accessHeaders() {
    var code = getStoredCode();
    return code ? { 'X-Access-Code': code } : {};
  }

  var socket = io({
    auth: function (cb) { cb({ code: getStoredCode() }); },
  });

  var gateAttempted = false;
  function showGate(errorMsg) {
    text($('gateError'), errorMsg || '');
    show($('view-gate'));
    $('gateInput').focus();
  }
  function hideGate() {
    hide($('view-gate'));
  }
  socket.on('connect_error', function (err) {
    if (err && err.message === 'invite-only') {
      showGate(gateAttempted ? 'Incorrect code. This beta is invite-only.' : null);
    }
  });
  $('gateSubmitBtn').addEventListener('click', submitGateCode);
  $('gateInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitGateCode(); }
  });
  function submitGateCode() {
    var code = $('gateInput').value.trim();
    if (!code) return;
    gateAttempted = true;
    $('gateSubmitBtn').disabled = true;
    fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
    }).then(function (r) { return r.json(); }).then(function (res) {
      $('gateSubmitBtn').disabled = false;
      if (res && res.ok) {
        localStorage.setItem('rankedsat.accessCode', code);
        text($('gateError'), '');
        hideGate();
        socket.connect();
      } else {
        text($('gateError'), 'Incorrect code. This beta is invite-only.');
      }
    }).catch(function () {
      $('gateSubmitBtn').disabled = false;
      text($('gateError'), 'Could not verify code — check your connection and try again.');
    });
  }

  // ---------- tiny helpers ----------
  function $(id) { return document.getElementById(id); }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  function text(el, s) { el.textContent = s; }
  function fmtTime(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtMs(ms) {
    if (ms == null) return '—';
    return (ms / 1000).toFixed(1) + 's';
  }
  function announce(msg) { text($('announcer'), msg); }
  function alertMsg(msg) { text($('alertRegion'), msg); }

  var DIFF_META = {
    easy:   { glyph: '●', word: 'Easy',   cls: 'diff-easy' },
    medium: { glyph: '◆', word: 'Medium', cls: 'diff-medium' },
    hard:   { glyph: '▲', word: 'Hard',   cls: 'diff-hard' },
  };

  function parseNumericClient(s) {
    if (typeof s !== 'string') return NaN;
    var t = s.trim();
    var frac = t.match(/^([-+]?\d+(?:\.\d+)?)\s*\/\s*([-+]?\d+(?:\.\d+)?)$/);
    if (frac) {
      var den = parseFloat(frac[2]);
      if (den === 0) return NaN;
      return parseFloat(frac[1]) / den;
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  // ---------- state ----------
  var storedName = localStorage.getItem('rankedsat.name');
  if (!storedName) {
    // Persist the generated name immediately so reloads keep the same identity.
    storedName = 'Player' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('rankedsat.name', storedName);
  }

  var state = {
    name: storedName,
    profile: null,
    view: 'lobby',
    queueTimer: null,
    queueStart: 0,
    match: null,       // { totalQuestions, clockSeconds, stake, desmos, oppName, oppIsBot, section }
    cq: null,          // current question payload
    selected: null,
    crossed: {},       // label -> true
    flagged: {},       // question index -> true
    crossMode: false,
    answered: false,
    finishedAll: false,
    oppCompleted: 0,
    youCompleted: 0,
    timerInterval: null,
    timerEndsAt: 0,
    timerHidden: localStorage.getItem('rankedsat.timerHidden') === '1',
    desmosState: 'unloaded', // unloaded | loading | ready | failed
    calc: null,
    lastResults: null,
  };

  // ---------- view switching ----------
  var VIEWS = ['lobby', 'queue', 'match', 'results', 'leaderboard'];
  function showView(name) {
    state.view = name;
    VIEWS.forEach(function (v) {
      var el = $('view-' + v);
      if (v === name) show(el); else hide(el);
    });
    document.body.classList.toggle('in-match', name === 'match');
    // The calculator only ever exists inside an active Desmos match.
    if (name !== 'match') closeCalc();
  }

  // ---------- identity / profile ----------
  function applyProfile(p) {
    state.profile = p;
    text($('playingAs'), p.name);
    text($('ratingEla'), String(p.ratings.ela));
    text($('ratingMath'), String(p.ratings.math));
    text($('gamesEla'), '(' + p.games.ela + ' game' + (p.games.ela === 1 ? '' : 's') + ')');
    text($('gamesMath'), '(' + p.games.math + ' game' + (p.games.math === 1 ? '' : 's') + ')');
    text($('recordLine'), p.wins + 'W – ' + p.losses + 'L – ' + p.draws + 'D');
  }

  function sayHello() {
    socket.emit('hello', { name: state.name }, function (res) {
      if (res && res.ok) {
        applyProfile(res.profile);
        if (res.profile.name !== state.name) {
          // Server de-duplicated the name for this window (another window owns it).
          text($('nameHint'), 'Name in use in another window — playing as "' + res.profile.name + '" here.');
        }
        state.name = res.profile.name;
      }
    });
  }

  socket.on('connect', function () {
    hideGate();
    text($('connStatus'), 'Connected');
    sayHello();
    if (state.view === 'queue') {
      // Server restarted / connection dropped while searching: back to lobby.
      stopQueueTimer();
      showView('lobby');
    }
  });
  socket.on('disconnect', function () {
    text($('connStatus'), 'Reconnecting…');
    if (state.view === 'match') {
      alertMsg('Connection lost — attempting to reconnect.');
      showBanner('Connection lost — reconnecting…');
    }
  });
  socket.on('profile', applyProfile);

  // ---------- lobby ----------
  $('nameInput').value = state.name;
  $('saveNameBtn').addEventListener('click', function () {
    var n = $('nameInput').value.trim();
    if (!n) return;
    state.name = n;
    localStorage.setItem('rankedsat.name', n);
    sayHello();
  });
  $('nameInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('saveNameBtn').click(); }
  });

  function chosenRadio(name) {
    var els = document.querySelectorAll('input[name="' + name + '"]');
    for (var i = 0; i < els.length; i++) if (els[i].checked) return els[i].value;
    return null;
  }

  $('findBtn').addEventListener('click', function () {
    var queue = chosenRadio('queue');
    // Persist latest typed name before queueing.
    var n = $('nameInput').value.trim();
    if (n && n !== state.name) { state.name = n; localStorage.setItem('rankedsat.name', n); }
    socket.emit('hello', { name: state.name }, function (res) {
      if (!res || !res.ok) return;
      applyProfile(res.profile);
      state.name = res.profile.name;
      socket.emit('joinQueue', { queue: queue }, function (jr) {
        if (!jr || !jr.ok) {
          alertMsg((jr && jr.error) || 'Could not join the queue.');
          return;
        }
        if (!jr.matched) {
          var qLabel = { 'ela': 'ELA', 'math-desmos': 'Math (Desmos)', 'math-nocalc': 'Math (No Desmos)' }[queue];
          text($('queueInfo'), qLabel + ' queue · difficulty adapts to both ratings');
          startQueueTimer();
          showView('queue');
          announce('Searching for an opponent.');
        }
        // If matched immediately, the matchFound event handles the transition.
      });
    });
  });

  $('navLobby').addEventListener('click', function () { if (state.view !== 'match') goLobby(); });
  $('navLeaderboard').addEventListener('click', function () { if (state.view !== 'match') openLeaderboard(); });
  $('lbLink').addEventListener('click', openLeaderboard);

  function goLobby() {
    socket.emit('toLobby', {}, function () {});
    showView('lobby');
  }

  // ---------- queue ----------
  function startQueueTimer() {
    state.queueStart = Date.now();
    stopQueueTimer();
    state.queueTimer = setInterval(function () {
      text($('queueElapsed'), fmtTime((Date.now() - state.queueStart) / 1000));
    }, 250);
  }
  function stopQueueTimer() {
    if (state.queueTimer) { clearInterval(state.queueTimer); state.queueTimer = null; }
  }
  $('cancelQueueBtn').addEventListener('click', function () {
    socket.emit('leaveQueue', {}, function () {
      stopQueueTimer();
      showView('lobby');
    });
  });

  // ---------- match lifecycle ----------
  socket.on('matchFound', function (m) {
    stopQueueTimer();
    state.match = {
      totalQuestions: m.totalQuestions,
      clockSeconds: m.clockSeconds,
      stake: m.stake,
      desmos: !!m.desmos,
      oppName: m.opponent.name,
      oppIsBot: !!m.opponent.isBot,
      section: m.section,
      queueLabel: m.queueLabel,
    };
    state.oppCompleted = 0;
    state.youCompleted = 0;
    state.finishedAll = false;
    state.flagged = {};
    state.cq = null;
    hideBanner();
    hide($('waitingNote'));
    hide($('lockedNote'));

    text($('youName'), m.you.name + ' (' + m.you.rating + ')');
    text($('oppName'), m.opponent.name + ' (' + m.opponent.rating + ')');
    if (m.opponent.isBot) show($('oppBotTag')); else hide($('oppBotTag'));
    text($('qTotal'), String(m.totalQuestions));
    renderPips();

    // The match clock is THE timer; show its full value until Q1 arrives.
    text($('timerText'), fmtTime(m.clockSeconds));
    var chip = $('stakeChip');
    text(chip, '±' + m.stake);
    chip.setAttribute('aria-label', 'This match is worth plus or minus ' + m.stake + ' rating');
    chip.title = 'This match is worth ±' + m.stake + ' rating';
    show(chip);

    var calcBtn = $('calcBtn');
    if (state.match.desmos) { show(calcBtn); ensureDesmosLoaded(); } else { hide(calcBtn); }
    closeCalc();

    applyTimerHidden();
    showView('match');
    announce('Match found. ' + m.queueLabel + ' duel against ' + m.opponent.name +
      (m.opponent.isBot ? ' (practice bot)' : '') + '. This match is worth plus or minus ' +
      m.stake + ' rating. Match clock ' + fmtTime(m.clockSeconds) + '. First question coming up.');
  });

  socket.on('question', function (payload) {
    state.cq = payload;
    state.selected = null;
    state.crossed = {};
    state.crossMode = false;
    state.answered = false;
    document.body.classList.remove('cross-mode');
    $('crossBtn').setAttribute('aria-pressed', 'false');
    $('flagBtn').setAttribute('aria-pressed', state.flagged[payload.index] ? 'true' : 'false');
    hide($('lockedNote'));
    hide($('waitingNote'));
    renderQuestion(payload);
    syncMatchClock(payload.clockRemainingMs); // server-authoritative resync each question
    text($('qNum'), String(payload.index + 1));
    renderPips();
    announce('Question ' + (payload.index + 1) + ' of ' + payload.total + ', ' +
      (DIFF_META[payload.question.difficulty] || {}).word + '. Opponent has completed ' +
      state.oppCompleted + ' of ' + payload.total + '.');
    if (payload.question.stemImageUrl) $('stemImg').focus();
    else $('stem').focus();
  });

  socket.on('clockExpired', function () {
    stopMatchClock();
    text($('timerText'), '0:00');
    state.answered = true; // block further submissions client-side too
    state.finishedAll = true;
    updateSubmitEnabled();
    $('sprInput').disabled = true;
    hide($('lockedNote'));
    text($('wnTitle'), 'Time’s up!');
    text($('wnText'), 'Your remaining questions were marked incorrect. Waiting for your opponent…');
    show($('waitingNote'));
    announce('Time is up. Your remaining questions were marked incorrect. Waiting for your opponent.');
  });

  socket.on('opponentProgress', function (p) {
    state.oppCompleted = p.completed;
    renderPips();
    // SR announcements for opponent progress are folded into question transitions only
    // (aria-live etiquette from the UX doc).
  });

  socket.on('opponentDisconnected', function (info) {
    var secs = Math.round((info.graceMs || 15000) / 1000);
    showBanner('Opponent disconnected — win by forfeit in ' + secs + 's unless they return.');
    alertMsg('Opponent disconnected. You win by forfeit in ' + secs + ' seconds unless they return.');
  });

  socket.on('matchEnd', function (payload) {
    stopMatchClock();
    hideBanner();
    state.lastResults = payload;
    renderResults(payload);
    showView('results');
    var msg = payload.outcome === 'win' ? 'You won.' : payload.outcome === 'loss' ? 'You lost.' : 'Draw.';
    announce('Match complete. ' + msg + ' Correct answers: you ' + payload.you.correctCount +
      ', opponent ' + payload.opponent.correctCount + '. Rating ' + payload.rating.after +
      ' (' + (payload.rating.delta >= 0 ? 'up ' : 'down ') + Math.abs(payload.rating.delta) + ').');
    $('resultHeadline').focus();
  });

  socket.on('rematchOffered', function (info) {
    text($('rematchStatus'), (info.from || 'Opponent') + ' wants a rematch — click Rematch to accept!');
  });
  socket.on('rematchDeclined', function (info) {
    text($('rematchStatus'), 'Rematch unavailable: ' + (info.reason || 'opponent left.'));
    $('rematchBtn').disabled = true;
  });

  // ---------- match banner ----------
  function showBanner(msg) { var b = $('matchBanner'); text(b, msg); show(b); }
  function hideBanner() { hide($('matchBanner')); }

  // ---------- rendering the question ----------
  function renderPips() {
    var total = state.match ? state.match.totalQuestions : 5;
    var youDone = state.youCompleted;
    var oppDone = state.oppCompleted;
    var youStr = '', oppStr = '';
    for (var i = 0; i < total; i++) {
      youStr += i < youDone ? '●' : '○';
      oppStr += i < oppDone ? '●' : '○';
    }
    var yp = $('youPips'), op = $('oppPips');
    text(yp, youStr);
    text(op, oppStr);
    yp.setAttribute('aria-label', 'Your progress: ' + youDone + ' of ' + total + ' answered');
    op.setAttribute('aria-label', 'Opponent progress: ' + oppDone + ' of ' + total + ' answered');
  }

  function renderQuestion(payload) {
    var q = payload.question;
    var isStemImage = !!q.stemImageUrl;
    var frame = $('qframe');

    // Stem-image questions (math, PDF-rendered): the image IS the full question,
    // including its answer choices — no stem text, passage, or choice texts.
    if (isStemImage) {
      frame.classList.remove('has-passage');
      hide($('passagePane'));
      hide($('stem'));
      text($('stem'), '');
      var simg = $('stemImg');
      simg.src = q.stemImageUrl;
      simg.alt = 'Math question (see image). ' + [q.domain, q.skill].filter(Boolean).join(' · ');
      show($('stemImageWrap'));
      hide($('figureWrap'));
      $('figureImg').removeAttribute('src');
    } else {
      hide($('stemImageWrap'));
      $('stemImg').removeAttribute('src');
      show($('stem'));
      // Passage split (ELA) vs single column.
      if (q.passage) {
        frame.classList.add('has-passage');
        show($('passagePane'));
        text($('passageText'), q.passage);
      } else {
        frame.classList.remove('has-passage');
        hide($('passagePane'));
      }
      text($('stem'), q.stem);
      if (q.figureUrl) {
        $('figureImg').src = q.figureUrl;
        show($('figureWrap'));
      } else {
        hide($('figureWrap'));
        $('figureImg').removeAttribute('src');
      }
    }

    // Meta
    var dm = DIFF_META[q.difficulty] || { glyph: '', word: q.difficulty, cls: '' };
    var chip = $('qDiff');
    chip.className = 'diff-chip ' + dm.cls;
    text(chip, dm.glyph + ' ' + dm.word);
    text($('qDomain'), [q.domain, q.skill].filter(Boolean).join(' · '));

    // Choices vs SPR
    var choicesEl = $('choices');
    choicesEl.innerHTML = '';
    choicesEl.classList.toggle('compact', isStemImage && q.type === 'mcq');
    if (q.type === 'mcq') {
      show(choicesEl);
      hide($('sprWrap'));
      q.choices.forEach(function (c, i) {
        var row = document.createElement('div');
        row.className = 'choice-row';
        row.dataset.label = c.label;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice-btn';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', c.text ? 'Choice ' + c.label + ': ' + c.text : 'Choice ' + c.label + ' (see question image)');
        btn.dataset.label = c.label;
        btn.dataset.idx = String(i);

        var letter = document.createElement('span');
        letter.className = 'letter';
        letter.setAttribute('aria-hidden', 'true');
        letter.textContent = c.label;

        var ctext = document.createElement('span');
        ctext.className = 'ctext';
        ctext.textContent = c.text;

        var selTag = document.createElement('span');
        selTag.className = 'selected-tag';
        selTag.textContent = 'Selected';

        btn.appendChild(letter);
        btn.appendChild(ctext);
        btn.appendChild(selTag);
        btn.addEventListener('click', function () { choiceActivated(i); });

        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'xout-btn';
        x.setAttribute('aria-pressed', 'false');
        x.setAttribute('aria-label', 'Cross out choice ' + c.label);
        x.textContent = 'X';
        x.addEventListener('click', function (e) { e.stopPropagation(); toggleCross(i); });

        row.appendChild(btn);
        row.appendChild(x);
        choicesEl.appendChild(row);
      });
    } else {
      hide(choicesEl);
      show($('sprWrap'));
      var inp = $('sprInput');
      inp.value = '';
      inp.disabled = false;
      text($('sprEcho'), '');
      inp.focus();
    }
    updateSubmitEnabled();
  }

  function choiceRows() {
    return Array.prototype.slice.call($('choices').querySelectorAll('.choice-row'));
  }

  function choiceActivated(idx) {
    if (state.answered || !state.cq || state.cq.question.type !== 'mcq') return;
    if (state.crossMode) { toggleCross(idx); return; }
    var rows = choiceRows();
    var row = rows[idx];
    if (!row) return;
    var label = row.dataset.label;
    // Selecting a crossed-out choice un-crosses it (Bluebook behavior).
    if (state.crossed[label]) setCross(idx, false);
    state.selected = (state.selected === label) ? null : label;
    rows.forEach(function (r) {
      var b = r.querySelector('.choice-btn');
      b.setAttribute('aria-pressed', r.dataset.label === state.selected ? 'true' : 'false');
    });
    updateSubmitEnabled();
  }

  function setCross(idx, value) {
    var row = choiceRows()[idx];
    if (!row) return;
    var label = row.dataset.label;
    state.crossed[label] = value;
    row.classList.toggle('crossed', value);
    row.querySelector('.xout-btn').setAttribute('aria-pressed', value ? 'true' : 'false');
    if (value && state.selected === label) {
      state.selected = null;
      row.querySelector('.choice-btn').setAttribute('aria-pressed', 'false');
      updateSubmitEnabled();
    }
  }
  function toggleCross(idx) {
    if (state.answered) return;
    var row = choiceRows()[idx];
    if (!row) return;
    setCross(idx, !state.crossed[row.dataset.label]);
  }

  function updateSubmitEnabled() {
    var ok = false;
    if (state.cq && !state.answered) {
      if (state.cq.question.type === 'mcq') ok = state.selected != null;
      else ok = $('sprInput').value.trim().length > 0;
    }
    $('submitBtn').disabled = !ok;
  }

  $('sprInput').addEventListener('input', function () {
    var v = $('sprInput').value.trim();
    var n = parseNumericClient(v);
    if (!v) text($('sprEcho'), '');
    else if (isNaN(n)) text($('sprEcho'), 'Not a number — will be submitted as text.');
    else text($('sprEcho'), 'Will be recorded as: ' + (v.indexOf('/') !== -1 ? v + ' = ' + (Math.round(n * 10000) / 10000) : n));
    updateSubmitEnabled();
  });

  // ---------- submit ----------
  $('submitBtn').addEventListener('click', submitAnswer);
  function submitAnswer() {
    if (!state.cq || state.answered) return;
    var q = state.cq.question;
    var ans = q.type === 'mcq' ? state.selected : $('sprInput').value.trim();
    if (ans == null || ans === '') return;
    state.answered = true;
    updateSubmitEnabled();
    $('sprInput').disabled = true;
    socket.emit('answer', { index: state.cq.index, answer: ans }, function (res) {
      if (!res || !res.ok) {
        // Rejected (e.g. clock expired first) — the server drives what happens next.
        showLocked(false, (res && res.error) || 'Answer not accepted.');
        return;
      }
      state.youCompleted = state.cq.index + 1;
      renderPips();
      showLocked(res.correct, null);
      if (state.youCompleted >= state.match.totalQuestions) {
        state.finishedAll = true;
        stopMatchClock();
        setTimeout(function () {
          if (state.finishedAll && state.view === 'match') {
            text($('wnTitle'), 'All done!');
            text($('wnText'), 'Waiting for your opponent to finish…');
            show($('waitingNote'));
          }
        }, 700);
      }
    });
  }

  /** Micro-reveal: your own correctness only (never the correct answer itself). */
  function showLocked(correct, customMsg) {
    var el = $('lockedNote');
    el.innerHTML = '';
    var span = document.createElement('span');
    if (customMsg) {
      span.textContent = customMsg;
    } else if (correct) {
      span.className = 'ok';
      span.textContent = '✓ Correct';
    } else {
      span.className = 'no';
      span.textContent = '✗ Incorrect';
    }
    el.appendChild(span);
    show(el);
  }

  // ---------- match clock (THE timer: one countdown for the whole match) ----------
  function syncMatchClock(remainingMs) {
    state.timerEndsAt = Date.now() + Math.max(0, remainingMs);
    tickTimer();
    if (!state.timerInterval) state.timerInterval = setInterval(tickTimer, 250);
  }
  function stopMatchClock() {
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  }
  function tickTimer() {
    var remain = (state.timerEndsAt - Date.now()) / 1000;
    text($('timerText'), fmtTime(Math.max(0, remain)));
  }
  $('timerToggle').addEventListener('click', function () {
    state.timerHidden = !state.timerHidden;
    localStorage.setItem('rankedsat.timerHidden', state.timerHidden ? '1' : '0');
    applyTimerHidden();
  });
  function applyTimerHidden() {
    var btn = $('timerToggle');
    btn.classList.toggle('timer-hidden', state.timerHidden);
    btn.setAttribute('aria-pressed', state.timerHidden ? 'true' : 'false');
    btn.setAttribute('aria-label', state.timerHidden ? 'Timer hidden. Show timer.' : 'Hide timer.');
  }

  // ---------- flag & cross-out mode ----------
  $('flagBtn').addEventListener('click', function () {
    if (!state.cq) return;
    var i = state.cq.index;
    state.flagged[i] = !state.flagged[i];
    $('flagBtn').setAttribute('aria-pressed', state.flagged[i] ? 'true' : 'false');
  });
  $('crossBtn').addEventListener('click', function () {
    if (!state.cq || state.cq.question.type !== 'mcq') return;
    state.crossMode = !state.crossMode;
    $('crossBtn').setAttribute('aria-pressed', state.crossMode ? 'true' : 'false');
    document.body.classList.toggle('cross-mode', state.crossMode);
  });

  // ---------- forfeit ----------
  $('quitMatchBtn').addEventListener('click', function () {
    if (window.confirm('Forfeit this match? Your opponent wins.')) {
      socket.emit('abandonMatch', {}, function () {});
    }
  });

  // ---------- Desmos ----------
  var DESMOS_URL = 'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6';
  function ensureDesmosLoaded(cb) {
    cb = cb || function () {};
    if (window.Desmos) { state.desmosState = 'ready'; return cb(true); }
    if (state.desmosState === 'failed') return cb(false);
    if (state.desmosState === 'loading') return; // first opener's callback wires the panel
    state.desmosState = 'loading';
    var s = document.createElement('script');
    s.src = DESMOS_URL;
    s.async = true;
    s.onload = function () { state.desmosState = 'ready'; cb(true); };
    s.onerror = function () { state.desmosState = 'failed'; cb(false); };
    document.head.appendChild(s);
  }
  function openCalc() {
    var panel = $('calcPanel');
    show(panel);
    $('calcBtn').setAttribute('aria-pressed', 'true');
    ensureDesmosLoaded(function (ok) { wireCalc(ok); });
    wireCalc(state.desmosState === 'ready');
  }
  function wireCalc(ready) {
    if (ready && !state.calc && window.Desmos) {
      state.calc = window.Desmos.GraphingCalculator($('calcHost'), { expressions: true, keypad: true });
      hide($('calcFallback'));
    } else if (state.desmosState === 'failed') {
      show($('calcFallback'));
    }
  }
  function closeCalc() {
    hide($('calcPanel'));
    $('calcBtn').setAttribute('aria-pressed', 'false');
  }
  function toggleCalc() {
    if (!state.match || !state.match.desmos) return;
    if ($('calcPanel').hidden) openCalc(); else closeCalc();
  }
  $('calcBtn').addEventListener('click', toggleCalc);
  $('calcCloseBtn').addEventListener('click', function () { closeCalc(); $('calcBtn').focus(); });

  // ---------- keyboard play ----------
  document.addEventListener('keydown', function (e) {
    if (state.view !== 'match') return;
    var inCalcPanel = $('calcPanel').contains(e.target);
    if (e.key === 'Escape') {
      if (!$('calcPanel').hidden) { closeCalc(); $('calcBtn').focus(); e.preventDefault(); }
      return;
    }
    // While focus is inside the Desmos panel, keys (incl. Enter) belong to Desmos.
    if (inCalcPanel) return;
    if (e.key === 'Enter') {
      // Enter submits from anywhere in the match screen once an answer is chosen —
      // including when focus sits on a just-clicked choice card. preventDefault stops
      // the focused button from also firing its click (which would toggle selection).
      if (!$('submitBtn').disabled) {
        e.preventDefault();
        submitAnswer();
      }
      return;
    }
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea';
    if (typing) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    var k = e.key.toLowerCase();
    var idx = -1;
    if (k >= '1' && k <= '4') idx = k.charCodeAt(0) - 49;
    else if (k >= 'a' && k <= 'd' && state.cq && state.cq.question.type === 'mcq') idx = k.charCodeAt(0) - 97;

    if (idx >= 0) {
      e.preventDefault();
      choiceActivated(idx);
    } else if (k === 'x') {
      e.preventDefault();
      $('crossBtn').click();
    } else if (k === 'f') {
      e.preventDefault();
      $('flagBtn').click();
    } else if (k === 'c') {
      e.preventDefault();
      toggleCalc();
    } else if (k === 't') {
      e.preventDefault();
      $('timerToggle').click();
    }
  });

  // ---------- results ----------
  function completionLabel(side, clockSeconds) {
    if (side.timedOut) return 'timed out (' + fmtTime(clockSeconds) + ' cap)';
    if (side.completionMs == null) return 'match ended early';
    return 'finished in ' + fmtTime(side.completionMs / 1000);
  }

  function renderResults(r) {
    var headline = r.outcome === 'win' ? 'You won!' : r.outcome === 'loss' ? 'You lost' : 'Draw';
    text($('resultHeadline'), headline + ' — ' + r.you.correctCount + '–' + r.opponent.correctCount);

    var fn = $('forfeitNote');
    if (r.forfeit) {
      text(fn, r.forfeit.youForfeited
        ? 'You forfeited (' + r.forfeit.reason + ') — opponent wins.'
        : 'Opponent ' + (r.forfeit.reason === 'disconnect' ? 'disconnected' : 'forfeited') + ' — win by forfeit.');
      show(fn);
    } else hide(fn);

    text($('resYouName'), r.you.name + ' (you)');
    text($('resYouScore'), r.you.correctCount + '/' + r.questions.length);
    text($('resYouLine'), completionLabel(r.you, r.clockSeconds));
    text($('resOppName'), r.opponent.name + (r.opponent.isBot ? ' (bot)' : ''));
    text($('resOppScore'), r.opponent.correctCount + '/' + r.questions.length);
    text($('resOppLine'), completionLabel(r.opponent, r.clockSeconds));

    var sec = r.section === 'ela' ? 'ELA' : 'Math';
    var d = r.rating.delta;
    text($('ratingLine'), sec + ' rating: ' + r.rating.before + ' → ' + r.rating.after +
      ' (' + (d >= 0 ? '+' : '') + d + ') · stake ±' + r.rating.stake +
      (r.outcome === 'draw' ? ' (draw — no change)' : ''));
    if (r.rating.opponentIsBot) show($('botRatedNote')); else hide($('botRatedNote'));

    var list = $('reviewList');
    list.innerHTML = '';
    r.questions.forEach(function (q) {
      list.appendChild(renderReviewItem(q));
    });

    $('rematchBtn').disabled = !r.rematchAvailable;
    text($('rematchStatus'), '');
  }

  function outcomeGlyph(res) {
    return res.correct ? '✓' : '✗';
  }

  function renderReviewItem(q) {
    var det = document.createElement('details');
    if (!q.you.correct) det.open = true; // default-open the ones you missed (learning surface)

    var sum = document.createElement('summary');
    var youSpan = document.createElement('span');
    youSpan.className = q.you.correct ? 'sum-ok' : 'sum-no';
    youSpan.textContent = outcomeGlyph(q.you) + ' You ' + (q.you.correct ? 'correct' : 'incorrect');
    var oppSpan = document.createElement('span');
    oppSpan.className = q.opponent.correct ? 'sum-ok' : 'sum-no';
    oppSpan.textContent = outcomeGlyph(q.opponent) + ' Opp ' + (q.opponent.correct ? 'correct' : 'incorrect');
    var dm = DIFF_META[q.difficulty] || { glyph: '', word: q.difficulty };
    sum.appendChild(document.createTextNode('Q' + (q.index + 1) + ' · '));
    sum.appendChild(youSpan);
    sum.appendChild(document.createTextNode(' · '));
    sum.appendChild(oppSpan);
    sum.appendChild(document.createTextNode(' · ' + dm.glyph + ' ' + dm.word));
    det.appendChild(sum);

    var body = document.createElement('div');
    body.className = 'review-body';

    if (q.stemImageUrl) {
      // Stem-image question: the image is the full question (stem + choices).
      var qimg = document.createElement('img');
      qimg.src = q.stemImageUrl;
      qimg.alt = 'Math question ' + (q.index + 1) + ' (see image). ' + [q.domain, q.skill].filter(Boolean).join(' · ');
      qimg.style.maxWidth = '100%';
      qimg.style.height = 'auto';
      body.appendChild(qimg);
    } else {
      if (q.passage) {
        var pass = document.createElement('div');
        pass.className = 'passage-text';
        pass.textContent = q.passage;
        body.appendChild(pass);
      }
      var stem = document.createElement('p');
      stem.style.whiteSpace = 'pre-wrap';
      stem.textContent = q.stem;
      body.appendChild(stem);

      if (q.figureUrl) {
        var img = document.createElement('img');
        img.src = q.figureUrl;
        img.alt = 'Figure for question ' + (q.index + 1);
        img.style.maxWidth = '100%';
        body.appendChild(img);
      }
    }

    if (q.type === 'mcq') {
      q.choices.forEach(function (c) {
        var row = document.createElement('div');
        row.className = 'review-choice';
        var isCorrect = c.label.toUpperCase() === q.correct.toUpperCase();
        if (isCorrect) row.classList.add('is-correct');
        row.appendChild(document.createTextNode(c.label + '. ' + c.text));
        if (isCorrect) row.appendChild(makeTag('t-correct', '✓ Correct answer'));
        if (q.you.answer && q.you.answer.toUpperCase() === c.label.toUpperCase()) row.appendChild(makeTag('t-you', 'Your answer'));
        if (q.opponent.answer && q.opponent.answer.toUpperCase() === c.label.toUpperCase()) row.appendChild(makeTag('t-opp', 'Opponent'));
        body.appendChild(row);
      });
      if (!q.you.answer) {
        var na = document.createElement('p');
        na.className = 'muted';
        na.textContent = 'You did not answer this question.';
        body.appendChild(na);
      }
    } else {
      var spr = document.createElement('p');
      spr.innerHTML = '';
      spr.textContent = 'Correct answer: ' + q.correct +
        ' · Your answer: ' + (q.you.answer == null ? '—' : q.you.answer) +
        ' · Opponent: ' + (q.opponent.answer == null ? '—' : q.opponent.answer);
      body.appendChild(spr);
    }

    if (q.rationale) {
      var rat = document.createElement('div');
      rat.className = 'rationale';
      var ratTitle = document.createElement('strong');
      ratTitle.textContent = 'Why: ';
      rat.appendChild(ratTitle);
      rat.appendChild(document.createTextNode(q.rationale));
      body.appendChild(rat);
    }

    var stats = document.createElement('p');
    stats.className = 'review-stats';
    stats.textContent = 'Time on this question: you ' + fmtMs(q.you.timeMs) + ' · opp ' + fmtMs(q.opponent.timeMs);
    body.appendChild(stats);

    det.appendChild(body);
    return det;
  }

  function makeTag(cls, label) {
    var t = document.createElement('span');
    t.className = 'tag ' + cls;
    t.textContent = label;
    return t;
  }

  $('rematchBtn').addEventListener('click', function () {
    socket.emit('rematch', {}, function (res) {
      if (!res || !res.ok) {
        text($('rematchStatus'), (res && res.error) || 'Rematch unavailable.');
        $('rematchBtn').disabled = true;
        return;
      }
      if (!res.starting) text($('rematchStatus'), 'Waiting for opponent to accept…');
    });
  });
  $('lobbyBtn').addEventListener('click', goLobby);

  // ---------- leaderboard ----------
  var lbSection = 'ela';
  function openLeaderboard() {
    fetch('/api/leaderboard', { headers: accessHeaders() })
      .then(function (r) {
        if (r.status === 401) { showGate(null); throw new Error('gated'); }
        return r.json();
      })
      .then(function (board) {
        renderLeaderboard(board);
        showView('leaderboard');
      })
      .catch(function (err) {
        if (err && err.message !== 'gated') alertMsg('Could not load the leaderboard.');
      });
  }
  function renderLeaderboard(board) {
    var rows = board[lbSection] || [];
    var body = $('lbBody');
    body.innerHTML = '';
    rows.forEach(function (p, i) {
      var tr = document.createElement('tr');
      [String(i + 1), p.name, String(p.rating), String(p.games), p.wins + '–' + p.losses + '–' + p.draws]
        .forEach(function (cell, ci) {
          var td = document.createElement('td');
          if (ci === 0 || ci === 2 || ci === 3) td.className = 'num';
          td.textContent = cell;
          tr.appendChild(td);
        });
      body.appendChild(tr);
    });
    if (rows.length === 0) show($('lbEmpty')); else hide($('lbEmpty'));
    $('lbTabEla').setAttribute('aria-selected', lbSection === 'ela' ? 'true' : 'false');
    $('lbTabMath').setAttribute('aria-selected', lbSection === 'math' ? 'true' : 'false');
  }
  $('lbTabEla').addEventListener('click', function () { lbSection = 'ela'; openLeaderboard(); });
  $('lbTabMath').addEventListener('click', function () { lbSection = 'math'; openLeaderboard(); });
  $('lbBackBtn').addEventListener('click', goLobby);

  // ---------- boot ----------
  applyTimerHidden();
  showView('lobby');
})();
