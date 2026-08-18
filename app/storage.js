'use strict';
/**
 * Pluggable player-persistence storage layer.
 *
 * Two backends, selected purely by environment:
 *   - local  (default): reads/writes data/players.json exactly as the server
 *     always has (atomic tmp+rename, corrupt-file quarantine). Zero behavior
 *     change when no Firebase env is configured.
 *   - firestore: activated when FIREBASE_SERVICE_ACCOUNT (full service-account
 *     JSON as a string) is set, OR when FIRESTORE_EMULATOR_HOST is set
 *     (emulator mode needs no credentials — just a projectId). Collection
 *     "players", one doc per player id (the same lowercased-name key the
 *     server already uses). Loaded into memory on boot; write-through on every
 *     profile mutation, fire-and-forget with error logging (fine at beta scale).
 *
 * Both backends expose the same async interface:
 *   loadAll()               -> Promise<{ [key]: profile }>
 *   save(playersMap, keys?) -> void (fire-and-forget)
 *     - local: ignores `keys`, atomically rewrites the whole file (unchanged
 *       behavior).
 *     - firestore: writes only `keys` (falls back to the whole map if omitted).
 */

const fs = require('fs');
const path = require('path');

function createLocalStorage(playersPath) {
  return {
    kind: 'local',

    async loadAll() {
      try {
        if (fs.existsSync(playersPath)) {
          const parsed = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
          if (parsed && typeof parsed.players === 'object') return parsed.players;
        }
      } catch (err) {
        const backup = playersPath + '.corrupt-' + Date.now();
        try { fs.renameSync(playersPath, backup); } catch { /* ignore */ }
        console.warn(`[players] players.json unreadable (${err.message}); moved to ${path.basename(backup)}`);
      }
      return {};
    },

    save(playersMap /*, keys */) {
      try {
        const dir = path.dirname(playersPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = playersPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ players: playersMap }, null, 2));
        fs.renameSync(tmp, playersPath);
      } catch (err) {
        console.error('[players] save failed:', err.message);
      }
    },
  };
}

function createFirestoreStorage() {
  const admin = require('firebase-admin');

  let initOpts;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    let creds;
    try {
      creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (err) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + err.message);
    }
    initOpts = { credential: admin.credential.cert(creds), projectId: creds.project_id };
  } else {
    // Emulator mode: FIRESTORE_EMULATOR_HOST is honored automatically by the
    // underlying client library — no credentials needed, just a projectId.
    initOpts = { projectId: process.env.FIREBASE_PROJECT_ID || 'rankedsat-local' };
  }

  const fbApp = admin.apps && admin.apps.length ? admin.app() : admin.initializeApp(initOpts);
  const db = admin.firestore(fbApp);
  const col = db.collection('players');

  return {
    kind: 'firestore',

    async loadAll() {
      const players = {};
      const snap = await col.get();
      snap.forEach(doc => { players[doc.id] = doc.data(); });
      return players;
    },

    save(playersMap, keys) {
      const touched = Array.isArray(keys) && keys.length ? keys : Object.keys(playersMap);
      touched.forEach(key => {
        const profile = playersMap[key];
        if (!profile) return;
        col.doc(key).set(profile).catch(err => {
          console.error(`[players] firestore write failed for "${key}":`, err.message);
        });
      });
    },
  };
}

/** Picks the backend from env. `playersPath` is only used by the local backend. */
function createStorage(playersPath) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIRESTORE_EMULATOR_HOST) {
    return createFirestoreStorage();
  }
  return createLocalStorage(playersPath);
}

module.exports = { createStorage };
