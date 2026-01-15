import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// --- Simple in-memory cache of parsed lists ---
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
  try {
    // Ensure the file exists before reading
    if (!fs.existsSync(filePath)) {
      throw new Error("File path does not exist: " + filePath);
    }

    const wb = XLSX.readFile(filePath); // This will now work with the fixed import
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    
    // Convert to JSON
    const json = XLSX.utils.sheet_to_json(ws, { defval: null });
    const headers = json.length ? Object.keys(json[0]) : [];
    
    return { headers, rows: json };
  } catch (error) {
    console.error("Error inside readSheetAsJson:", error.message);
    throw error;
  }
}

// --- Domain-specific helpers for medical / cardiovascular analysis ---

const MEDICAL_KEYWORDS = [
  'atrial',
  'ventricular',
  'systole',
  'diastole',
  'mr',       // mitral regurgitation
  'mv',       // mitral valve
  'pml',      // posterior mitral leaflet
];

function normalizeString(val) {
  if (val == null) return '';
  return String(val).toLowerCase();
}

/**
 * Inspect headers for medical keywords
 * and describe simple dependencies around systole / diastole columns.
 * Also detects name-like columns and returns encrypted samples.
 */
function analyzeMedicalData(headers, rows) {
  const keywordStats = {};
  const totalRows = rows.length;

  MEDICAL_KEYWORDS.forEach(kw => {
    keywordStats[kw] = {
      keyword: kw,
      inHeaders: [],
      inColumns: [],
      hitCount: 0,
      sampleValues: [],
    };
  });

  const systoleHeaders = [];
  const diastoleHeaders = [];
  const nameHeaders = [];

  // Scan headers first
  headers.forEach(h => {
    const hNorm = normalizeString(h);
    MEDICAL_KEYWORDS.forEach(kw => {
      if (hNorm.includes(kw)) {
        keywordStats[kw].inHeaders.push(h);
        keywordStats[kw].hitCount += 1;
      }
    });
    if (hNorm.includes('systole') || hNorm.includes('systolic')) systoleHeaders.push(h);
    if (hNorm.includes('diastole') || hNorm.includes('diastolic')) diastoleHeaders.push(h);
    if (hNorm.includes('name') || hNorm.includes('patient')) nameHeaders.push(h);
  });

  // Very lightweight "dependency" description:
  // For every row that has a systolic or diastolic value,
  // check what other columns appear alongside and count them.
  const dependencyCounter = {};

  rows.forEach((row) => {
    const hasSystole = systoleHeaders.some(h => row[h] != null && row[h] !== '');
    const hasDiastole = diastoleHeaders.some(h => row[h] != null && row[h] !== '');

    if (!hasSystole && !hasDiastole) return;

    headers.forEach((h) => {
      if (isNameLikeHeader(h)) return; // never build dependencies on name columns
      const val = row[h];
      if (val == null || val === '') return;
      const key = h;
      dependencyCounter[key] = (dependencyCounter[key] || 0) + 1;
    });
  });

  const phaseDependencies = Object.entries(dependencyCounter)
    .sort((a, b) => b[1] - a[1])
    .map(([header, count]) => ({
      header,
      coOccurrenceCount: count,
    }));

  const anyHits = MEDICAL_KEYWORDS.some(kw => keywordStats[kw].hitCount > 0 || keywordStats[kw].inHeaders.length > 0);

  // Encrypt (hash) example values from name-like columns so we don't expose raw identifiers
  const encryptedNameColumns = nameHeaders.map(h => {
    const samples = [];
    for (const row of rows) {
      if (samples.length >= 5) break;
      const val = row[h];
      if (val == null || val === '') continue;
      const hash = crypto.createHash('sha256').update(String(val)).digest('hex');
      samples.push(hash);
    }
    return {
      header: h,
      encryptedSamples: samples,
    };
  });

  return {
    isMedicalLike: anyHits,
    keywords: keywordStats,
    systoleHeaders,
    diastoleHeaders,
    phaseDependencies,
    nameColumns: encryptedNameColumns,
    meta: {
      totalRows,
      totalHeaders: headers.length,
    },
  };
}

// ---- Privacy helpers: hide name-like columns from client retrieval ----

function isNameLikeHeader(header) {
  const h = normalizeString(header);
  return h.includes('name') || h.includes('patient');
}

/**
 * Given full headers/rows, strip any columns that look like names
 * before returning data to the client.
 */
function stripNameColumns(headers, rows) {
  const filteredHeaders = headers.filter(h => !isNameLikeHeader(h));
  const filteredRows = rows.map((row) => {
    const out = {};
    filteredHeaders.forEach((h) => {
      out[h] = row[h];
    });
    return out;
  });
  return { headers: filteredHeaders, rows: filteredRows };
}

// ---- Deeper dependency analysis between numeric columns ----

function toNumberOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n === 0 || ys.length !== n) return null;
  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumY2 += y * y;
    sumXY += x * y;
  }
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (!den) return null;
  return num / den;
}

function analyzeColumnDependencies(headers, rows) {
  const numericHeaders = headers.filter(h => !isNameLikeHeader(h));
  const pairs = [];

  for (let i = 0; i < numericHeaders.length; i++) {
    for (let j = i + 1; j < numericHeaders.length; j++) {
      const h1 = numericHeaders[i];
      const h2 = numericHeaders[j];
      const xs = [];
      const ys = [];

      for (const row of rows) {
        const n1 = toNumberOrNull(row[h1]);
        const n2 = toNumberOrNull(row[h2]);
        if (n1 === null || n2 === null) continue;
        xs.push(n1);
        ys.push(n2);
      }

      if (xs.length < 5) continue; // need enough points
      const r = pearson(xs, ys);
      if (r === null || Number.isNaN(r)) continue;

      pairs.push({
        colA: h1,
        colB: h2,
        correlation: r,
        samples: xs.length,
      });
    }
  }

  // Sort by absolute correlation strength, descending
  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    pairs,
    meta: {
      totalPairs: pairs.length,
      minSamplesPerPair: 5,
    },
  };
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
    const stripped = stripNameColumns(headers, rows);
    return res.json(stripped);
  }

  const filePath = resolveUploadPath(name);
  if (!filePath) return res.status(404).json({ error: 'List not found' });

  try {
    const { headers, rows } = readSheetAsJson(filePath);
    putListUnderAllKeys(path.basename(filePath), name, rows);
    const stripped = stripNameColumns(headers, rows);
    return res.json(stripped);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to read rows' });
  }
});

// --- Analysis endpoint: inspect uploaded sheet for medical patterns ---
app.post('/api/analyze', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing list/file name' });

  // Prefer in-memory list if present
  if (memoryLists.has(name)) {
    const rows = memoryLists.get(name) || [];
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const analysis = analyzeMedicalData(headers, rows);
    return res.json({ name, source: 'memory', analysis });
  }

  const filePath = resolveUploadPath(name);
  if (!filePath) return res.status(404).json({ error: 'List/file not found' });

  try {
    const { headers, rows } = readSheetAsJson(filePath);
    putListUnderAllKeys(path.basename(filePath), name, rows);
    const analysis = analyzeMedicalData(headers, rows);
    return res.json({ name, source: 'file', analysis });
  } catch (e) {
    console.error('Analyze error:', e);
    return res.status(500).json({ error: 'Failed to analyze data' });
  }
});

// --- Numeric dependency endpoint: analyze correlations between columns ---
app.post('/api/dependencies', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing list/file name' });

  // Prefer in-memory list if present
  if (memoryLists.has(name)) {
    const rows = memoryLists.get(name) || [];
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const deps = analyzeColumnDependencies(headers, rows);
    return res.json({ name, source: 'memory', dependencies: deps });
  }

  const filePath = resolveUploadPath(name);
  if (!filePath) return res.status(404).json({ error: 'List/file not found' });

  try {
    const { headers, rows } = readSheetAsJson(filePath);
    putListUnderAllKeys(path.basename(filePath), name, rows);
    const deps = analyzeColumnDependencies(headers, rows);
    return res.json({ name, source: 'file', dependencies: deps });
  } catch (e) {
    console.error('Dependencies analyze error:', e);
    return res.status(500).json({ error: 'Failed to analyze column dependencies' });
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

async function callAiModel(filePath) {
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  formData.append('file', blob, path.basename(filePath));

  const response = await fetch('http://localhost:8080/graph/process', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log('AI model response:', data);
  return data;
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing file name to analyze' });

    const filePath = resolveUploadPath(name);
    if (!filePath) return res.status(404).json({ error: 'File not found' });

    const graph = await callAiModel(filePath);

    const { rows } = readSheetAsJson(filePath);

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

/* Model endpoint */

const API_URL = "http://localhost:8000"; // FastAPI URL

export const predictCardiacInteraction = async (data) => {
  try {
    const response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "Prediction failed");
    }

    return await response.json();
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
};

app.listen(4000, () => console.log('Server listening on :4000'));
