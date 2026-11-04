const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('node:fs/promises');

let mainWindow;

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu-command', command);
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-project') },
        { type: 'separator' },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open') },
        { label: 'Save Project…', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save-project') },
        { label: 'Export BIN…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('export-bin') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendCommand('redo') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f9faf7',
    icon: path.join(__dirname, '..', 'icons', 'tick tack.ico'),
    title: 'Tick / Tack — Watchface Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function clockFaceEditImageIndexes(project) {
  const items = Object.values(project || {}).filter((item) => (
    item && typeof item === 'object' && Number.isInteger(item.Type)
  ));
  if (!items.length) return [];

  const indexes = new Set();
  let frameCount = 0;
  for (const item of items) {
    if (!Number.isInteger(item.ImageIndex) || item.ImageIndex < 0 || item.ImageIndex > 65535
      || !Number.isInteger(item.ImagesCount) || item.ImagesCount < 1 || item.ImagesCount > 255) {
      throw new Error(`ClockFaceEdit item ${item.Type} has invalid image references.`);
    }
    frameCount += item.ImagesCount;
    if (frameCount > 512) throw new Error('ClockFaceEdit project references too many image frames.');
    for (let frame = 0; frame < item.ImagesCount; frame += 1) indexes.add(item.ImageIndex + frame);
  }
  return [...indexes];
}

ipcMain.handle('open-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open watch face or project',
    properties: ['openFile'],
    filters: [
      { name: 'Watch faces and projects', extensions: ['bin', 'wfproj', 'json'] },
      { name: 'Watch-face BIN', extensions: ['bin'] },
      { name: 'Watchface Studio project', extensions: ['wfproj', 'json'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath);
  let assets;
  if (path.extname(filePath).toLowerCase() === '.json') {
    let project;
    try {
      project = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Could not read project JSON: ${error.message}`);
      throw error;
    }
    const imageIndexes = clockFaceEditImageIndexes(project);
    if (imageIndexes.length) {
      assets = {};
      for (const index of imageIndexes) {
        const imagePath = path.join(path.dirname(filePath), `${index}.png`);
        try {
          assets[index] = new Uint8Array(await fs.readFile(imagePath));
        } catch (error) {
          if (error.code === 'ENOENT') throw new Error(`ClockFaceEdit project image is missing: ${index}.png`);
          throw error;
        }
      }
    }
  }
  return { name: path.basename(filePath), bytes: new Uint8Array(content), assets };
});

ipcMain.handle('save-file', async (_event, request) => {
  if (!mainWindow) return null;
  if (!request || !['project', 'bin'].includes(request.kind)) {
    throw new Error('Choose a valid project or BIN export format.');
  }

  const isProject = request.kind === 'project';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: isProject ? 'Save Watchface Studio project' : 'Export watch-face BIN',
    defaultPath: path.basename(request.defaultName || (isProject ? 'Watchface.wfproj' : 'Watchface.bin')),
    filters: [{ name: isProject ? 'Watchface Studio project' : 'Watch-face BIN', extensions: [isProject ? 'wfproj' : 'bin'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const output = isProject ? Buffer.from(request.data, 'utf8') : Buffer.from(request.bytes);
  await fs.writeFile(result.filePath, output);
  return result.filePath;
});

app.whenReady().then(() => {
  createMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
