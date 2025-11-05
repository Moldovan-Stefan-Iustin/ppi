const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

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

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  console.log('Saved file:', req.file.path);
  res.json({ message: 'File received', path: req.file.path });
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

    return res.json({ message: `File ${filename} deleted successfully` });
  });
});

app.listen(4000, () => console.log('Server listening on :4000'));
