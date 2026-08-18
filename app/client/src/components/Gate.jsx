import React, { useState } from 'react';

/**
 * Access-code screen, shown only when the server rejects the socket handshake
 * with "invite-only" (i.e. RANKEDSAT_ACCESS_CODE is set).
 *
 * Verifying via /api/verify-code makes the server set the rs_access cookie,
 * which is what lets <img src="/figures/..."> through the gate — image tags
 * cannot send an auth header, and the figures ARE the question bank.
 */
export default function Gate({ onUnlocked }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (r.ok) {
        try { localStorage.setItem('rankedsat.code', code.trim()); } catch { /* ignore */ }
        onUnlocked(code.trim());
      } else {
        const j = await r.json().catch(() => ({}));
        setErr(j.error || 'That code was not accepted.');
      }
    } catch {
      setErr('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="p-head"><span>Restricted</span><span className="rule" /></div>
        <h1 className="gate-title">The hall is locked</h1>
        <p className="gate-sub">Enter your access code to continue.</p>
        <input
          className="input" type="password" autoFocus autoComplete="off"
          value={code} onChange={(e) => setCode(e.target.value)}
          aria-label="Access code"
        />
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
