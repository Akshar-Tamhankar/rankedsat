import { useCallback, useEffect, useRef, useState } from 'react';
/* eslint-disable react-hooks/exhaustive-deps */
import { io } from 'socket.io-client';

/**
 * The whole client/server protocol in one hook. Events and payload shapes are
 * unchanged from the vanilla client — server.js was not touched by the React
 * port, so this is a straight transcription:
 *
 *   emit  hello{name}->cb  joinQueue{queue}->cb  leaveQueue  toLobby
 *         answer{index,answer}->cb  abandonMatch  rematch->cb
 *   on    profile  matchFound  question  clockExpired  opponentProgress
 *         opponentDisconnected  matchEnd  rematchOffered  rematchDeclined
 *
 * The server holds all answer keys and timestamps everything; nothing here is
 * authoritative. The local clock below is display-only and is resynced from
 * `clockRemainingMs` on every question.
 */

const STORE_KEY = 'rankedsat.name';

export function useGame() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState('');
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(STORE_KEY) || ''; } catch { return ''; }
  });

  // view: 'lobby' | 'queue' | 'match' | 'results'
  const [view, setView] = useState('lobby');
  const [queueInfo, setQueueInfo] = useState(null);
  const [match, setMatch] = useState(null);
  const [question, setQuestion] = useState(null);
  const [answered, setAnswered] = useState([]); // per-index {answer, correct}
  const [oppCompleted, setOppCompleted] = useState(0);
  const [clockMs, setClockMs] = useState(0);
  const [clockDead, setClockDead] = useState(false);
  const [banner, setBanner] = useState('');
  const [result, setResult] = useState(null);
  const [rematch, setRematch] = useState({ offered: false, sent: false, note: '' });

  const clockRef = useRef({ endsAt: 0, raf: 0 });

  // ---- connection ---------------------------------------------------------
  // `locked` flips true when the server rejects the handshake because an
  // access code is required; App then shows the Gate.
  const [locked, setLocked] = useState(false);
  const [codeTick, setCodeTick] = useState(0);
  const unlock = useCallback(() => { setLocked(false); setCodeTick((n) => n + 1); }, []);

  useEffect(() => {
    let stored = '';
    try { stored = localStorage.getItem('rankedsat.code') || ''; } catch { /* ignore */ }
    const s = io({ autoConnect: true, auth: stored ? { code: stored } : undefined });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      setConnError('');
      s.emit('hello', { name: nameRef.current }, (res) => {
        if (res && res.ok) {
          setProfile(res.profile);
          if (res.profile && res.profile.name) {
            setName(res.profile.name);
            try { localStorage.setItem(STORE_KEY, res.profile.name); } catch { /* ignore */ }
          }
        }
      });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err) => {
      const msg = err && err.message ? err.message : 'Connection failed';
      if (/invite-only/i.test(msg)) { setLocked(true); setConnError(''); return; }
      setConnError(msg);
    });
    s.on('profile', setProfile);

    s.on('matchFound', (m) => {
      setMatch(m);
      setQuestion(null);
      setAnswered([]);
      setOppCompleted(0);
      setClockDead(false);
      setBanner('');
      setResult(null);
      setRematch({ offered: false, sent: false, note: '' });
      startClock(m.clockSeconds * 1000);
      setView('match');
    });

    s.on('question', (payload) => {
      setQuestion(payload);
      // server-authoritative resync every question
      startClock(payload.clockRemainingMs);
    });

    s.on('clockExpired', () => {
      setClockDead(true);
      setClockMs(0);
      stopClock();
      setBanner('Your clock ran out. Remaining questions count as wrong.');
    });

    s.on('opponentProgress', (p) => setOppCompleted(p.completed));

    s.on('opponentDisconnected', (info) => {
      setBanner((info && info.message) || 'Your opponent disconnected.');
    });

    s.on('matchEnd', (payload) => {
      stopClock();
      setResult(payload);
      setQuestion(null);
      setView('results');
    });

    s.on('rematchOffered', () => setRematch((r) => ({ ...r, offered: true, note: 'Your opponent wants a rematch.' })));
    s.on('rematchDeclined', (info) => setRematch({ offered: false, sent: false, note: (info && info.reason) || 'Rematch declined.' }));

    return () => { stopClock(); s.close(); };
    // re-runs after a successful unlock so the socket reconnects with the code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeTick]);

  // keep a ref of name so the connect handler always sends the latest
  const nameRef = useRef(name);
  useEffect(() => { nameRef.current = name; }, [name]);

  // ---- display clock ------------------------------------------------------
  const startClock = useCallback((ms) => {
    stopClock();
    if (!ms || ms <= 0) { setClockMs(0); return; }
    clockRef.current.endsAt = performance.now() + ms;
    setClockMs(ms);
    const step = () => {
      const left = clockRef.current.endsAt - performance.now();
      setClockMs(left > 0 ? left : 0);
      if (left > 0) clockRef.current.raf = requestAnimationFrame(step);
    };
    clockRef.current.raf = requestAnimationFrame(step);
  }, []);

  function stopClock() {
    if (clockRef.current.raf) cancelAnimationFrame(clockRef.current.raf);
    clockRef.current.raf = 0;
  }

  // ---- actions ------------------------------------------------------------
  const saveName = useCallback((next) => {
    return new Promise((resolve) => {
      const s = socketRef.current;
      if (!s) return resolve({ ok: false, error: 'Not connected.' });
      s.emit('hello', { name: next }, (res) => {
        if (res && res.ok) {
          setProfile(res.profile);
          const n = (res.profile && res.profile.name) || next;
          setName(n);
          try { localStorage.setItem(STORE_KEY, n); } catch { /* ignore */ }
        }
        resolve(res || { ok: false });
      });
    });
  }, []);

  const joinQueue = useCallback(async (queue) => {
    const s = socketRef.current;
    if (!s) return { ok: false, error: 'Not connected.' };
    // The server rejects joinQueue without a name, so make sure one is set.
    const res = await new Promise((resolve) => s.emit('hello', { name: nameRef.current }, resolve));
    if (res && res.ok && res.profile) setProfile(res.profile);
    return new Promise((resolve) => {
      s.emit('joinQueue', { queue }, (jr) => {
        if (jr && jr.ok) {
          setQueueInfo({ queue, at: Date.now() });
          setView('queue');
        }
        resolve(jr || { ok: false });
      });
    });
  }, []);

  const leaveQueue = useCallback(() => {
    const s = socketRef.current;
    if (s) s.emit('leaveQueue', {}, () => {});
    setQueueInfo(null);
    setView('lobby');
  }, []);

  const submitAnswer = useCallback((index, answer) => {
    return new Promise((resolve) => {
      const s = socketRef.current;
      if (!s) return resolve({ ok: false });
      s.emit('answer', { index, answer }, (res) => {
        if (res && res.ok) {
          setAnswered((a) => {
            const next = a.slice();
            next[index] = { answer, correct: res.correct };
            return next;
          });
        }
        resolve(res || { ok: false });
      });
    });
  }, []);

  const forfeit = useCallback(() => {
    const s = socketRef.current;
    if (s) s.emit('abandonMatch', {}, () => {});
    stopClock();
    setView('lobby');
    setMatch(null);
    setQuestion(null);
  }, []);

  const toLobby = useCallback(() => {
    const s = socketRef.current;
    if (s) s.emit('toLobby', {}, () => {});
    setView('lobby');
    setMatch(null);
    setQuestion(null);
    setResult(null);
  }, []);

  // ---- solo study (practice / timed module / mock exam) -------------------
  const [solo, setSolo] = useState(null);       // server-rendered session state
  const [soloFb, setSoloFb] = useState(null);   // practice-only per-question feedback

  const soloStart = useCallback((opts) => {
    const s = socketRef.current;
    if (!s) return Promise.resolve({ ok: false });
    return new Promise((resolve) => {
      s.emit('soloStart', opts, (res) => {
        if (res && res.ok) { setSolo(res.state); setSoloFb(null); setView('practice'); }
        resolve(res || { ok: false });
      });
    });
  }, []);

  const soloAnswer = useCallback((answer) => {
    const s = socketRef.current;
    if (!s) return Promise.resolve({ ok: false });
    return new Promise((resolve) => {
      s.emit('soloAnswer', { answer }, (res) => {
        if (res && res.ok) { setSolo(res.state); setSoloFb(res.feedback || null); }
        resolve(res || { ok: false });
      });
    });
  }, []);

  const soloNext = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    s.emit('soloNext', {}, (res) => {
      if (res && res.ok) { setSolo(res.state); setSoloFb(null); }
    });
  }, []);

  // The module clock is the server's; poll it so an expiry lands even if the
  // player has stopped answering.
  const soloSync = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    s.emit('soloSync', {}, (res) => { if (res && res.ok) setSolo(res.state); });
  }, []);

  const [history, setHistory] = useState([]);

  const soloEnd = useCallback(() => {
    const s = socketRef.current;
    if (s) s.emit('soloEnd', {}, (res) => { if (res && res.ok) setHistory(res.history || []); });
    setSolo(null);
    setSoloFb(null);
    setView('lobby');
  }, []);

  const loadHistory = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    s.emit('soloHistory', {}, (res) => { if (res && res.ok) setHistory(res.history || []); });
  }, []);

  /** Pass an id to drop one session, or nothing to clear the lot. */
  const clearHistory = useCallback((id) => {
    const s = socketRef.current;
    if (!s) return;
    s.emit('soloClearHistory', id ? { id } : {}, (res) => {
      if (res && res.ok) setHistory(res.history || []);
    });
  }, []);

  const askRematch = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    setRematch((r) => ({ ...r, sent: true, note: 'Rematch offered — waiting…' }));
    s.emit('rematch', {}, (res) => {
      if (res && !res.ok) setRematch((r) => ({ ...r, sent: false, note: res.error || 'Could not offer a rematch.' }));
    });
  }, []);

  return {
    connected, connError, locked, unlock, profile, name, setName,
    view, setView, queueInfo, match, question, answered, oppCompleted,
    clockMs, clockDead, banner, result, rematch,
    saveName, joinQueue, leaveQueue, submitAnswer, forfeit, toLobby, askRematch,
    solo, soloFb, soloStart, soloAnswer, soloNext, soloSync, soloEnd,
    history, loadHistory, clearHistory,
  };
}

export async function fetchLeaderboard() {
  try {
    const r = await fetch('/api/leaderboard');
    if (!r.ok) return { ela: [], math: [] };
    return await r.json();
  } catch {
    return { ela: [], math: [] };
  }
}

/**
 * ONE shared leaderboard poll for the whole hall.
 *
 * Decal, Board and Pill each ran their own fetch + 30s interval, so the same
 * data was pulled three times and each arrival re-rendered the entire Hall
 * subtree independently. Now: a single timer, one request, one broadcast.
 */
let boardCache = { ela: [], math: [] };
let boardSubs = new Set();
let boardTimer = null;

function pumpBoard() {
  fetchLeaderboard().then((b) => {
    boardCache = b;
    boardSubs.forEach((fn) => fn(b));
  });
}

export function useLeaderboard() {
  const [board, setBoard] = useState(boardCache);
  useEffect(() => {
    boardSubs.add(setBoard);
    if (boardSubs.size === 1) {
      pumpBoard();
      boardTimer = setInterval(pumpBoard, 30000);
    } else {
      setBoard(boardCache);
    }
    return () => {
      boardSubs.delete(setBoard);
      if (boardSubs.size === 0 && boardTimer) { clearInterval(boardTimer); boardTimer = null; }
    };
  }, []);
  return board;
}
