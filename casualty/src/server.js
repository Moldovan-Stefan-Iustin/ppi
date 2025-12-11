const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const cors = require('cors');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const memoryLists = new Map();

function toSafe(name) {
  return name.replace(/[^a-z0-9.\-_]/gi, '_');
}

function safeCandidates(original) {
  return [
    original,
    original.replace(/ /g, '_'),
    toSafe(original),
  ];
}

function putListUnderAllKeys(originalName, savedName, rows) {
  for (const key of new Set([
    ...safeCandidates(originalName),
    ...safeCandidates(savedName),
  ])) {
    memoryLists.set(key, rows);
  }
}

function deleteAllKeysForSaved(savedName) {
  for (const key of [...memoryLists.keys()]) {
    if (key === savedName || key === toSafe(savedName) || key === savedName.replace(/ /g, '_')) {
      memoryLists.delete(key);
    }
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-z0-9\.\-\_]/gi, '_');
    cb(null, `${ts}_${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json());

function resolveUploadPath(filename) {
  for (const cand of safeCandidates(filename)) {
    const p = path.join(uploadDir, cand);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readSheetAsJson(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  const headers = json.length ? Object.keys(json[0]) : [];
  return { wb, sheetName, ws, headers, rows: json };
}

function writeJsonToSheet(filePath, headers, rows) {
  const aoa = [headers];
  for (const r of rows) {
    aoa.push(headers.map(h => r[h] ?? null));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filePath);
}

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const { rows } = readSheetAsJson(req.file.path);
    putListUnderAllKeys(req.file.originalname, req.file.filename, rows);

    console.log('Saved file:', req.file.path, 'Rows stored in memory:', rows.length);
    res.json({
      message: 'File received & list created',
      path: req.file.path,
      savedName: req.file.filename,
      originalName: req.file.originalname,
      count: rows.length,
    });
  } catch (e) {
    console.error('Upload parse error:', e);
    res.status(500).json({ error: 'Upload ok, but failed to parse Excel' });
  }
});

app.get("/api/files", (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to read uploads directory" });
    }

    const fileDetails = files.map((file) => {
      const stats = fs.statSync(path.join(uploadDir, file));
      return {
        name: file,
        size: stats.size,
        uploadedAt: stats.mtime,
      };
    });

    res.json(fileDetails);
  });
});

app.get('/api/file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/api/file', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing file name' });

  const candidates = safeCandidates(name);
  
  let foundPath = null;
  for (const candidate of candidates) {
    const p = path.join(uploadDir, candidate);
    if (fs.existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  console.log('[GET /api/file]',
      'asked:', name,
      'candidates:', candidates,
      'found:', foundPath
  );

  if (!foundPath) return res.status(404).json({ error: 'File not found' });
  res.sendFile(foundPath);
});

app.get('/api/lists', (req, res) => {
  const data = Array.from(memoryLists.entries()).map(([name, rows]) => ({
    name,
    count: Array.isArray(rows) ? rows.length : 0,
  }));
  res.json(data);
});

app.get('/api/list', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing list name' });

  if (memoryLists.has(name)) {
    return res.json({ name, rows: memoryLists.get(name) || [] });
  }

  const filePath = resolveUploadPath(name);
  if (!filePath) return res.status(404).json({ error: 'List not found' });

  try {
    const { rows } = readSheetAsJson(filePath);
    putListUnderAllKeys(path.basename(filePath), name, rows);
    return res.json({ name, rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to read list from file' });
  }
});

app.get('/api/rows', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing list name' });

  if (memoryLists.has(name)) {
    const rows = memoryLists.get(name) || [];
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return res.json({ headers, rows });
  }

  const filePath = resolveUploadPath(name);
  if (!filePath) return res.status(404).json({ error: 'List not found' });

  try {
    const { headers, rows } = readSheetAsJson(filePath);
    putListUnderAllKeys(path.basename(filePath), name, rows);
    return res.json({ headers, rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to read rows' });
  }
});

app.post('/api/rows', (req, res) => {
  const { name } = req.query;
  const { row } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing list name' });
  if (!row || typeof row !== 'object') return res.status(400).json({ error: 'Missing row payload' });

  if (!memoryLists.has(name)) {
    const filePath = resolveUploadPath(name);
    if (filePath) {
      try {
        const { rows } = readSheetAsJson(filePath);
        putListUnderAllKeys(path.basename(filePath), name, rows);
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to load list' });
      }
    } else {
      return res.status(404).json({ error: 'List not found' });
    }
  }

  const rows = memoryLists.get(name);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : Object.keys(row);
  const normalized = {};
  for (const h of headers) normalized[h] = row[h] ?? null;
  rows.push(normalized);

  return res.json({ message: 'Row added to list', index: rows.length - 1 });
});

app.put('/api/rows/:index', (req, res) => {
  const { name } = req.query;
  const i = parseInt(req.params.index, 10);
  const { row } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing list name' });
  if (!Number.isInteger(i) || i < 0) return res.status(400).json({ error: 'Invalid index' });

  if (!memoryLists.has(name)) {
    return res.status(404).json({ error: 'List not found in memory' });
  }

  const rows = memoryLists.get(name);
  if (i >= rows.length) return res.status(404).json({ error: 'Row index out of bounds' });

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const updated = {};
  for (const h of headers) {
    updated[h] = (row && Object.prototype.hasOwnProperty.call(row, h)) ? row[h] : rows[i][h];
  }
  rows[i] = updated;

  return res.json({ message: 'Row updated in list' });
});

app.delete('/api/rows/:index', (req, res) => {
  const { name } = req.query;
  const i = parseInt(req.params.index, 10);
  if (!name) return res.status(400).json({ error: 'Missing list name' });
  if (!Number.isInteger(i) || i < 0) return res.status(400).json({ error: 'Invalid index' });

  if (!memoryLists.has(name)) {
    return res.status(404).json({ error: 'List not found in memory' });
  }

  const rows = memoryLists.get(name);
  if (i >= rows.length) return res.status(404).json({ error: 'Row index out of bounds' });

  rows.splice(i, 1);
  return res.json({ message: 'Row deleted from list' });
});

// ===== AI graph stub endpoint =====
// Later you can replace the "callAiModel" function with a real HTTP call
// to your model endpoint (passing the file or rows as needed).
const SAMPLE_GRAPH = {
  nodes: [
    { feature: 'mr_area', label: 'MR area (cm2)' },
    { feature: 'la_area', label: 'LA area (cm2)' },
    { feature: 'la_length', label: 'LA length (cm)' },
    { feature: 'la_volume', label: 'LA volume (ml)' },
    { feature: 'mv_tenting_height', label: 'MV tenting height (mm)' },
    { feature: 'mv_annulus', label: 'MV annulus (mm)' },
    { feature: 'lv_area', label: 'LV area (cm2)' },
    { feature: 'lv_length', label: 'LV length (cm)' },
    { feature: 'lv_volume', label: 'LV volume (ml)' },
  ],
  edges: [
    { source: 'la_area', destination: 'mr_area', weight: 0.42 },
    { source: 'la_volume', destination: 'mr_area', weight: 0.35 },
    { source: 'mv_tenting_height', destination: 'mr_area', weight: 0.28 },
    { source: 'mr_area', destination: 'mv_tenting_height', weight: 0.32 },
  ],
};

async function callAiModel({ rows }) {
  // TODO: swap this stub with a real API call, e.g.:
  // const resp = await fetch('https://your-ai-endpoint', { ... });
  // return await resp.json();
  // For now, return the provided sample so the UI can be wired up.
  return SAMPLE_GRAPH;
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing file name to analyze' });

    const filePath = resolveUploadPath(name);
    if (!filePath) return res.status(404).json({ error: 'File not found' });

    const { rows } = readSheetAsJson(filePath);
    const graph = await callAiModel({ rows });

    return res.json({
      graph,
      meta: {
        name,
        rows: rows.length,
      },
    });
  } catch (e) {
    console.error('AI analyze error', e);
    return res.status(500).json({ error: 'Failed to get AI analysis' });
  }
});

app.delete("/api/delete/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to delete file" });
    }

    deleteAllKeysForSaved(filename);
    return res.json({ message: `File ${filename} deleted successfully` });
  });
});

app.listen(4000, () => console.log('Server listening on :4000'));
