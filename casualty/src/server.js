// const express = require('express');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const XLSX = require('xlsx');
//
// const uploadDir = path.join(__dirname, 'uploads');
// if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
//
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, uploadDir),
//   filename: (req, file, cb) => {
//     const ts = Date.now();
//     const safe = file.originalname.replace(/[^a-z0-9\.\-\_]/gi, '_');
//     cb(null, `${ts}_${safe}`);
//   }
// });
// const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB
//
// const app = express();
//
// app.post('/api/upload', upload.single('file'), (req, res) => {
//   if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
//   console.log('Saved file:', req.file.path);
//   res.json({ message: 'File received', path: req.file.path });
// });
//
// app.get("/api/files", (req, res) => {
//   fs.readdir(uploadDir, (err, files) => {
//     if (err) {
//       console.error(err);
//       return res.status(500).json({ error: "Failed to read uploads directory" });
//     }
//
//     const fileDetails = files.map((file) => {
//       const stats = fs.statSync(path.join(uploadDir, file));
//       return {
//         name: file,
//         size: stats.size,
//         uploadedAt: stats.mtime,
//       };
//     });
//
//     res.json(fileDetails);
//   });
// });
//
// app.get('/api/file/:filename', (req, res) => {
//   const { filename } = req.params;
//   const filePath = path.join(uploadDir, filename);
//   if (!fs.existsSync(filePath)) {
//     return res.status(404).json({ error: 'File not found' });
//   }
//   res.sendFile(filePath);
// });
//
// app.get('/api/file', (req, res) => {
//   const { name } = req.query;
//   if (!name) return res.status(400).json({ error: 'Missing file name' });
//
//   const candidates = [
//     name,
//     name.replace(/ /g, '_'),
//     name.replace(/[^a-z0-9.\-_]/gi, '_'),
//   ];
//
//   let foundPath = null;
//   for (const candidate of candidates) {
//     const p = path.join(uploadDir, candidate);
//     if (fs.existsSync(p)) {
//       foundPath = p;
//       break;
//     }
//   }
//
//   console.log('[GET /api/file]',
//       'asked:', name,
//       'candidates:', candidates,
//       'found:', foundPath
//   );
//
//   if (!foundPath) return res.status(404).json({ error: 'File not found' });
//   res.sendFile(foundPath);
// });
//
// function safeCandidates(original) {
//   return [
//     original,
//     original.replace(/ /g, '_'),
//     original.replace(/[^a-z0-9.\-_]/gi, '_'),
//   ];
// }
//
// function resolveUploadPath(filename) {
//   for (const cand of safeCandidates(filename)) {
//     const p = path.join(uploadDir, cand);
//     if (fs.existsSync(p)) return p;
//   }
//   return null;
// }
//
// function readSheetAsJson(filePath) {
//   const wb = XLSX.readFile(filePath, { cellDates: true });
//   const sheetName = wb.SheetNames[0];
//   const ws = wb.Sheets[sheetName];
//   const json = XLSX.utils.sheet_to_json(ws, { defval: null });
//   const headers = json.length ? Object.keys(json[0]) : [];
//   return { wb, sheetName, ws, headers, rows: json };
// }
//
// function writeJsonToSheet(filePath, headers, rows) {
//   const aoa = [headers];
//   for (const r of rows) {
//     aoa.push(headers.map(h => r[h] ?? null));
//   }
//   const ws = XLSX.utils.aoa_to_sheet(aoa);
//   const wb = XLSX.utils.book_new();
//   XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
//   XLSX.writeFile(wb, filePath);
// }
//
// // GET /api/rows?name=<filename>  -> { headers, rows }
// app.get('/api/rows', (req, res) => {
//   const { name } = req.query;
//   if (!name) return res.status(400).json({ error: 'Missing file name' });
//
//   const filePath = resolveUploadPath(name);
//   if (!filePath) return res.status(404).json({ error: 'File not found' });
//
//   try {
//     const { headers, rows } = readSheetAsJson(filePath);
//     return res.json({ headers, rows });
//   } catch (e) {
//     console.error(e);
//     return res.status(500).json({ error: 'Failed to read rows' });
//   }
// });
//
// // POST /api/rows?name=<filename>  body: { row: { colA: val, ... } }
// app.post('/api/rows', express.json(), (req, res) => {
//   const { name } = req.query;
//   const { row } = req.body || {};
//   if (!name) return res.status(400).json({ error: 'Missing file name' });
//   if (!row || typeof row !== 'object') return res.status(400).json({ error: 'Missing row payload' });
//
//   const filePath = resolveUploadPath(name);
//   if (!filePath) return res.status(404).json({ error: 'File not found' });
//
//   try {
//     const { headers, rows } = readSheetAsJson(filePath);
//     // Ensure all known headers exist in the new row (undefined -> null)
//     const normalized = {};
//     for (const h of headers) normalized[h] = row[h] ?? null;
//     rows.push(normalized);
//     writeJsonToSheet(filePath, headers, rows);
//     return res.json({ message: 'Row added', index: rows.length - 1 });
//   } catch (e) {
//     console.error(e);
//     return res.status(500).json({ error: 'Failed to add row' });
//   }
// });
//
// // PUT /api/rows/:index?name=<filename>  body: { row: { ... } }
// app.put('/api/rows/:index', express.json(), (req, res) => {
//   const { name } = req.query;
//   const i = parseInt(req.params.index, 10);
//   const { row } = req.body || {};
//   if (!name) return res.status(400).json({ error: 'Missing file name' });
//   if (!Number.isInteger(i) || i < 0) return res.status(400).json({ error: 'Invalid index' });
//
//   const filePath = resolveUploadPath(name);
//   if (!filePath) return res.status(404).json({ error: 'File not found' });
//
//   try {
//     const { headers, rows } = readSheetAsJson(filePath);
//     if (i >= rows.length) return res.status(404).json({ error: 'Row index out of bounds' });
//
//     const updated = {};
//     for (const h of headers) {
//       // If a column is provided in payload, use it; otherwise keep previous value
//       updated[h] = (row && Object.prototype.hasOwnProperty.call(row, h)) ? row[h] : rows[i][h];
//     }
//     rows[i] = updated;
//     writeJsonToSheet(filePath, headers, rows);
//     return res.json({ message: 'Row updated' });
//   } catch (e) {
//     console.error(e);
//     return res.status(500).json({ error: 'Failed to update row' });
//   }
// });
//
// // DELETE /api/rows/:index?name=<filename>
// app.delete('/api/rows/:index', (req, res) => {
//   const { name } = req.query;
//   const i = parseInt(req.params.index, 10);
//   if (!name) return res.status(400).json({ error: 'Missing file name' });
//   if (!Number.isInteger(i) || i < 0) return res.status(400).json({ error: 'Invalid index' });
//
//   const filePath = resolveUploadPath(name);
//   if (!filePath) return res.status(404).json({ error: 'File not found' });
//
//   try {
//     const { headers, rows } = readSheetAsJson(filePath);
//     if (i >= rows.length) return res.status(404).json({ error: 'Row index out of bounds' });
//
//     rows.splice(i, 1);
//     writeJsonToSheet(filePath, headers, rows);
//     return res.json({ message: 'Row deleted' });
//   } catch (e) {
//     console.error(e);
//     return res.status(500).json({ error: 'Failed to delete row' });
//   }
// });
//
//
// app.delete("/api/delete/:filename", (req, res) => {
//   const { filename } = req.params;
//   const filePath = path.join(uploadDir, filename);
//
//   if (!fs.existsSync(filePath)) {
//     return res.status(404).json({ error: "File not found" });
//   }
//
//   fs.unlink(filePath, (err) => {
//     if (err) {
//       console.error(err);
//       return res.status(500).json({ error: "Failed to delete file" });
//     }
//
//     return res.json({ message: `File ${filename} deleted successfully` });
//   });
// });
//
// app.listen(4000, () => console.log('Server listening on :4000'));


const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const cors = require('cors');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ===== In-memory lists: filename -> array of row objects =====
/**
 * For each newly uploaded Excel, we create/overwrite an in-memory list.
 * Keys used:
 *  - saved filename (e.g., 1730834022000_myfile.xlsx)
 *  - original filename as uploaded by the user (e.g., myfile.xlsx)
 *  - safe normalized variants for both (spaces -> _, strip unsafe chars)
 */
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
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

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
  for (const r of rows) aoa.push(headers.map(h => r[h] ?? null));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filePath);
}

// ===== Upload & files =====
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // Parse immediately and create an in-memory list keyed by file names
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
    if (err) return res.status(500).json({ error: "Failed to read uploads directory" });

    const fileDetails = files.map((file) => {
      const stats = fs.statSync(path.join(uploadDir, file));
      return { name: file, size: stats.size, uploadedAt: stats.mtime };
    });

    res.json(fileDetails);
  });
});

app.get('/api/file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

app.get('/api/file', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing file name' });

  let foundPath = null;
  for (const candidate of safeCandidates(name)) {
    const p = path.join(uploadDir, candidate);
    if (fs.existsSync(p)) { foundPath = p; break; }
  }
  if (!foundPath) return res.status(404).json({ error: 'File not found' });
  res.sendFile(foundPath);
});

// ===== New: in-memory lists API =====
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

  // Fallback: if not in memory, try disk (helpful after server restarts)
  const filePath = resolveUploadPath(name);
  if (!filePath) return res.status(404).json({ error: 'List not found' });

  try {
    const { rows } = readSheetAsJson(filePath);
    // Populate the in-memory list now
    putListUnderAllKeys(path.basename(filePath), name, rows);
    return res.json({ name, rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to read list from file' });
  }
});

// ===== CRUD operations on IN-MEMORY LISTS =====
app.get('/api/rows', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing list name' });

  // Try to get from memory first
  if (memoryLists.has(name)) {
    const rows = memoryLists.get(name) || [];
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return res.json({ headers, rows });
  }

  // Fallback: load from disk and populate memory
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

  // Work with in-memory list
  if (!memoryLists.has(name)) {
    // Try to load from disk first
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

app.delete("/api/delete/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ error: "Failed to delete file" });

    // drop related in-memory keys
    deleteAllKeysForSaved(filename);
    return res.json({ message: `File ${filename} deleted successfully` });
  });
});

app.listen(4000, () => console.log('Server listening on :4000'));
