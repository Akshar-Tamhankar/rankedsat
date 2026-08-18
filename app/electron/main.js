'use strict';
/**
 * RankedSat desktop shell (Windows + macOS).
 *
 * The app is a normal Express + socket.io server with a React client, so the
 * desktop build just hosts that server inside Electron's main process and
 * points a window at it. Nothing about duels, grading or matchmaking changes —
 * the server stays authoritative, which is the whole security model.
 *
 * Three things the desktop build has to get right:
 *
 *  1. PORT 0. Ask the OS for a free port instead of hard-coding 3000, so the
 *     app never collides with a dev server or a second copy of itself.
 *
 *  2. Writable state. Inside a packaged app the resources directory is
 *     read-only (notably a signed .app on macOS), so players.json goes to
 *     Electron's per-user data dir instead.
 *
 *  3. Read-only content paths. questions.jsonl and figures/ ship inside the
 *     asar-unpacked resources, which is a different path in dev vs packaged.
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');

const isDev = !app.isPackaged;

// server.js sits one level up from this file in BOTH layouts — <repo>/app/
// in dev, and the asar root when packaged (electron-builder copies
// `electron/**` and `server.js` as siblings). So this path needs no branch;
// branching on isDev here is exactly what broke the first packaged build.
const SERVER_ENTRY = path.join(__dirname, '..', 'server.js');

// Read-only content is different: extraResources lands it in
// process.resourcesPath when packaged, but it lives in the repo in dev.
const RES_ROOT = isDev ? path.resolve(__dirname, '..', '..') : process.resourcesPath;

const DATA_DIR = path.join(RES_ROOT, 'data');
const STATE_DIR = app.getPath('userData');

process.env.PORT = '0';
process.env.RANKEDSAT_QUESTIONS = path.join(DATA_DIR, 'questions.jsonl');
process.env.RANKEDSAT_FIGURES = path.join(DATA_DIR, 'figures');
process.env.RANKEDSAT_STATE_DIR = STATE_DIR;
// The boot warning about ephemeral state is a container concern; here the
// state dir is the OS user-data directory and is genuinely persistent.
process.env.RANKEDSAT_DESKTOP = '1';

// ---------------------------------------------------------------------------
// GPU
//
// Chromium keeps a driver blocklist and quietly falls back to SOFTWARE
// compositing when it distrusts a GPU — which is ruinous here, because the
// design leans on backdrop-filter and transform animation. A measured example
// on an Intel iGPU came back with gpu_compositing / rasterization / 2d_canvas
// all "disabled_software", i.e. the CPU was drawing every blurred pixel.
//
// These switches ask for hardware paths anyway. They must be set before the
// app is ready. If they don't take, detectGpu() below downgrades the UI
// instead of letting the machine grind.
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('canvas-oop-rasterization');

let win = null;
let httpServer = null;
let gpuMode = 'unknown';   // 'hardware' | 'software'

/** True when Chromium is compositing on the GPU rather than the CPU. */
function detectGpu() {
  try {
    const st = app.getGPUFeatureStatus() || {};
    const composite = String(st.gpu_compositing || '');
    const raster = String(st.rasterization || '');
    const soft = composite.includes('software') || raster.includes('software');
    gpuMode = soft ? 'software' : 'hardware';
  } catch {
    gpuMode = 'unknown';
  }
  return gpuMode;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14100c',
    show: false,
    title: 'RankedSat',
    webPreferences: {
      // The renderer is ordinary web content talking to localhost over HTTP.
      // It needs no Node access, so it does not get any.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(url);

  // Desmos help links and anything else external belong in the real browser,
  // not in a chromeless app window with no back button.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) {
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) {
      e.preventDefault();
      shell.openExternal(target);
    }
  });

  win.on('closed', () => { win = null; });
}

function buildMenu(url, mode) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(STATE_DIR),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About RankedSat',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'RankedSat',
            message: 'RankedSat',
            detail: `Local practice + 1v1 SAT duels.\n\nServing: ${url}\n`
              + `Ratings and stats: ${STATE_DIR}\n`
              + `Graphics: ${mode === 'hardware' ? 'GPU accelerated' : `${mode} (reduced effects)`}\n\n`
              + 'The Desmos calculator needs an internet connection; '
              + 'everything else works offline.',
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot() {
  // Fail loudly and legibly if the content did not get packaged.
  if (!fs.existsSync(process.env.RANKEDSAT_QUESTIONS)) {
    dialog.showErrorBox(
      'RankedSat — missing question bank',
      `Could not find:\n${process.env.RANKEDSAT_QUESTIONS}\n\n`
      + 'The question bank did not ship with this build.');
    app.quit();
    return;
  }

  try {
    const { start } = require(SERVER_ENTRY);
    httpServer = await start();
  } catch (err) {
    dialog.showErrorBox('RankedSat — server failed to start', String(err && err.stack || err));
    app.quit();
    return;
  }

  const base = `http://localhost:${httpServer.address().port}`;
  // Tell the client what it's running on. A query param rather than IPC keeps
  // the renderer fully sandboxed with no preload bridge.
  const mode = detectGpu();
  const url = `${base}/?gpu=${mode}`;
  console.log(`[gpu] compositing: ${mode}`);
  buildMenu(base, mode);
  createWindow(url);
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  // macOS convention is to stay alive until Cmd-Q.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
    createWindow(`http://localhost:${httpServer.address().port}`);
  }
});

app.on('before-quit', () => {
  if (httpServer) { try { httpServer.close(); } catch { /* shutting down */ } }
});
