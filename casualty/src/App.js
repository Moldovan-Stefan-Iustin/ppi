import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import axios from "axios";
import './App.css';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = ['xlsx', 'xls', 'csv'];

export default function ExcelUploader() {
  const [previewRows, setPreviewRows] = useState(null);
  const [sheetName, setSheetName] = useState(null);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const fileInputRef = useRef();
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFile,setSelectedFile] = useState(-1);

  const [columns, setColumns] = useState([]);        // headers from Excel
  const [rows, setRows] = useState([]);              // rows from server
  const [newRow, setNewRow] = useState({});          // add-form model
  const [editIndex, setEditIndex] = useState(-1);    // row currently being edited
  const [editRow, setEditRow] = useState({});        // edit-form model

  // New: in-memory lists and preview toggle
  const [lists, setLists] = useState([]);            // [{name, count}]
  const [showPreview, setShowPreview] = useState(false); // Toggle between preview and edit mode
  const [graphData, setGraphData] = useState(null);  // AI graph response
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState(null);

  function getSelectedFilename() {
    return (selectedFile >= 0 && uploadedFiles[selectedFile]) ? uploadedFiles[selectedFile].name : null;
  }

  // Auto-load preview and rows when a file is selected
  React.useEffect(() => {
    if (selectedFile >= 0 && uploadedFiles[selectedFile]) {
      setShowPreview(false); // Default to edit mode
      retrieveSelectedFile();
      loadRows();
    } else {
      // Clear state when no file is selected
      setColumns([]);
      setRows([]);
      setPreviewRows(null);
      setSheetName(null);
      setShowPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, uploadedFiles]);

  // Load files and lists on mount
  React.useEffect(() => {
    getFiles();
    getLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetUI() {
    setPreviewRows(null);
    setSheetName(null);
    setError(null);
    setUploadProgress(0);
    setUploading(false);
    setSuccessMsg(null);
    fileInputRef.current = null;
  }

  function validateFile(file) {
    if (!file)
      return "No file provided.";
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXT.includes(ext))
      return `Invalid file type .${ext}. Allowed: ${ALLOWED_EXT.join(', ')}`;
    if (file.size > MAX_FILE_SIZE)
      return `File too large (${(file.size/1024/1024).toFixed(1)} MB). Max ${(MAX_FILE_SIZE/1024/1024)} MB.`;
    return null;
  }

  function getRowsForPreview(json, limit = null) {
    return Array.isArray(json) ? (limit ? json.slice(0, limit) : json) : [];
  }

  async function handleFile(file, { parse = true } = {}) {
    resetUI();
    const v = validateFile(file);
    if (v) { setError(v); return; }

    if (parse) {
      try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        setSheetName(firstSheetName);
        setPreviewRows(getRowsForPreview(json));
      } catch (err) {
        console.error("Parse error:", err);
        setError("Failed to parse Excel file. Is it a valid spreadsheet?");
        return;
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current._selectedFile = file;
    } else {
      fileInputRef.current = { _selectedFile: file };
    }
  }

  async function onDropHandler(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const file = ev.dataTransfer?.files?.[0];
    if (file) await handleFile(file);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  async function handleInputChange(e) {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
  }

  async function uploadSelectedFile() {
    setError(null);
    setSuccessMsg(null);
    const file = fileInputRef.current?._selectedFile;
    if (!file)
      { setError("No file selected to upload."); return; }

    const form = new FormData();
    form.append("file", file);

    try {
      setUploading(true);
      setUploadProgress(0);
      const res = await axios.post("/api/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / (progressEvent.total || file.size));
          setUploadProgress(percent);
        },
        timeout: 5 * 60 * 1000, // 5 minutes
      });
      await getFiles();
      await getLists(); // refresh in-memory lists
      setSuccessMsg(res?.data?.message || "Upload complete");
      setPreviewRows(null);
      setSheetName(null);
      setError(null);
      setUploadProgress(0);
      fileInputRef.current = null;
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function getFiles(){
    setUploadedFiles((await axios.get("api/files")).data);
  }

  async function removeFile(){
    if (selectedFile < 0 ){
      setError("No file was selected");
      return;
    }
    try{
      await axios.delete("api/delete/" + uploadedFiles[selectedFile].name);
      setUploadedFiles(prev => prev.filter((_, i) => i !== selectedFile));
      setSuccessMsg("File has been deleted successfully");
      setSelectedFile(-1);
      await getLists(); // may remove related in-memory list keys
    }catch(err){
      console.log(err);
      setError(err?.response?.data?.error || err.message || "File removal failed");
    }
  }

  async function retrieveSelectedFile() {
    if (selectedFile < 0) return;

    try {
      const name = uploadedFiles[selectedFile].name;
      const res = await axios.get(`/api/file?name=${encodeURIComponent(name)}`, {
        responseType: 'arraybuffer',
      });

      const workbook = XLSX.read(res.data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: null });

      setSheetName(firstSheetName);
      setPreviewRows(getRowsForPreview(json));
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to retrieve file');
    }
  }

  async function loadRows() {
    const name = getSelectedFilename();
    if (!name) return;
    try {
      const res = await axios.get('/api/rows', { params: { name }});
      setColumns(res.data.headers || []);
      setRows(res.data.rows || []);
      // initialize add form with empty fields
      const empty = {};
      (res.data.headers || []).forEach(h => empty[h] = '');
      setNewRow(empty);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to load rows');
    }
  }

  function onChangeNewField(col, value) {
    setNewRow(prev => ({ ...prev, [col]: value }));
  }

  async function addRow() {
    setError(null);
    const name = getSelectedFilename();
    if (!name) { setError('No file selected.'); return; }
    try {
      await axios.post('/api/rows', { row: newRow }, { params: { name }});
      await loadRows(); // refresh
      await getLists(); // refresh lists count
      setSuccessMsg('Row added.');
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to add row');
    }
  }

  async function deleteRowAt(index) {
    setError(null);
    const name = getSelectedFilename();
    if (!name) { setError('No file selected.'); return; }
    try {
      await axios.delete(`/api/rows/${index}`, { params: { name }});
      await loadRows();
      await getLists(); // refresh lists count
      setSuccessMsg('Row deleted.');
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to delete row');
    }
  }

  function beginEdit(index) {
    setEditIndex(index);
    setEditRow({ ...rows[index] });
  }

  function onChangeEditField(col, value) {
    setEditRow(prev => ({ ...prev, [col]: value }));
  }

  async function saveEdit() {
    setError(null);
    const name = getSelectedFilename();
    if (!name) { setError('No file selected.'); return; }
    try {
      await axios.put(`/api/rows/${editIndex}`, { row: editRow }, { params: { name }});
      setEditIndex(-1);
      setEditRow({});
      await loadRows();
      await getLists(); // refresh lists
      setSuccessMsg('Row updated.');
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to update row');
    }
  }

  function cancelEdit() {
    setEditIndex(-1);
    setEditRow({});
  }

  // ===== In-memory lists helpers =====
  async function getLists() {
    try {
      const res = await axios.get('/api/lists');
      setLists(res.data || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load lists');
    }
  }

  async function analyzeWithAi() {
    setError(null);
    setGraphError(null);
    setSuccessMsg(null);
    setGraphData(null);
    const name = getSelectedFilename();
    if (!name) { setError('No file selected.'); return; }
    try {
      setGraphLoading(true);
      const res = await axios.post('/api/analyze', { name });
      setGraphData(res.data?.graph || null);
      setSuccessMsg('AI analysis complete (stub data).');
    } catch (err) {
      console.error(err);
      setGraphError(err?.response?.data?.error || err.message || 'AI analysis failed');
    } finally {
      setGraphLoading(false);
    }
  }

  function GraphView({ graph }) {
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return null;
    const nodes = graph.nodes;
    const edges = Array.isArray(graph.edges) ? graph.edges : [];

    // simple radial layout
    const radius = 160;
    const center = { x: 200, y: 200 };
    const positions = {};
    nodes.forEach((n, idx) => {
      const angle = (idx / nodes.length) * Math.PI * 2;
      positions[n.feature] = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      };
    });

    return (
      <div className="graph-card">
        <h4 style={{ marginTop: 0 }}>AI Graph</h4>
        <svg width={400} height={400}>
          {/* edges */}
          {edges.map((e, idx) => {
            const from = positions[e.source];
            const to = positions[e.destination];
            if (!from || !to) return null;
            const weight = typeof e.weight === 'number' ? e.weight : 0.2;
            const strokeWidth = Math.max(1, weight * 5);
            return (
              <g key={`edge-${idx}`}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="#6b7280"
                  strokeWidth={strokeWidth}
                  strokeOpacity="0.8"
                />
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2}
                  fill="#374151"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {weight.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* nodes */}
          {nodes.map((n, idx) => {
            const pos = positions[n.feature];
            return (
              <g key={`node-${idx}`}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={18}
                  fill="#3b82f6"
                  stroke="#1d4ed8"
                  strokeWidth="2"
                />
                <text
                  x={pos.x}
                  y={pos.y}
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {idx + 1}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="graph-legend">
          {nodes.map((n, idx) => (
            <div key={`legend-${idx}`} className="graph-legend-row">
              <span className="legend-badge">{idx + 1}</span>
              <div className="legend-labels">
                <div className="legend-title">{n.label || n.feature}</div>
                <div className="legend-sub">{n.feature}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
  <div className="excel-uploader">
    <h2>Upload Excel file</h2>

    <div
      className="drop-zone"
      onDrop={onDropHandler}
      onDragOver={onDragOver}
    >
      <p>Drag & drop a spreadsheet here, or</p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleInputChange}
      />
      <div className="allowed-files">
        Allowed: .xlsx, .xls, .csv — Max {(MAX_FILE_SIZE/1024/1024)} MB
      </div>
    </div>

    {error && <div className="error-msg">{error}</div>}
    {successMsg && <div className="success-msg">{successMsg}</div>}

    {/* Toggle button for preview/edit mode */}
    {selectedFile >= 0 && columns.length > 0 && (
      <div style={{ marginTop: 24 }}>
        <button onClick={() => setShowPreview(!showPreview)}>
          {showPreview ? 'Switch to Edit Mode' : 'Switch to Preview Mode'}
        </button>
      </div>
    )}

    {/* Preview Mode - Read-only view */}
    {showPreview && sheetName && previewRows && previewRows.length > 0 && (
      <div className="preview-container" style={{ marginTop: 12 }}>
        <h4>Preview: {getSelectedFilename()} (sheet: {sheetName}) — {previewRows.length} rows</h4>
        <table>
          <thead>
            <tr>
              {Object.keys(previewRows[0] || {}).map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i}>
                {Object.keys(previewRows[0] || {}).map(k => (
                  <td key={k}>{String(row[k] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {/* Edit Mode - CRUD operations */}
    {!showPreview && selectedFile >= 0 && (
      <>
        {/* Add new row form */}
        {columns.length > 0 && (
          <div style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 4 }}>
            <h4>Add New Row</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              {columns.map(col => (
                <div key={col}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>{col}</label>
                  <input
                    style={{ width: '100%', padding: 4 }}
                    value={newRow[col] ?? ''}
                    onChange={e => onChangeNewField(col, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <button onClick={addRow} style={{ marginTop: 12 }}>Add Row</button>
          </div>
        )}

        {/* Editable table */}
        {columns.length > 0 && rows.length > 0 && (
          <div className="crud-table" style={{ marginTop: 24, overflowX: 'auto' }}>
            <h4>Editable Table: {getSelectedFilename()} ({rows.length} rows)</h4>
            <table>
              <thead>
                <tr>
                  {columns.map(c => <th key={c}>{c}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map(c => (
                      <td key={c}>
                        {editIndex === i ? (
                          <input
                            value={editRow[c] ?? ''}
                            onChange={e => onChangeEditField(c, e.target.value)}
                          />
                        ) : (
                          String(r[c] ?? '')
                        )}
                      </td>
                    ))}
                    <td>
                      {editIndex === i ? (
                        <>
                          <button onClick={saveEdit}>Save</button>
                          <button onClick={cancelEdit}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => beginEdit(i)}>Edit</button>
                          <button onClick={() => deleteRowAt(i)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}

    <div className="button-group">
      <button onClick={uploadSelectedFile} disabled={uploading}>
        {uploading ? `Uploading (${uploadProgress}%)` : "Upload file to server"}
      </button>
      <button onClick={() => { resetUI(); if (fileInputRef.current) fileInputRef.current._selectedFile = null; }}>
        Cancel upload
      </button>
      <button onClick={getFiles}> Refresh files </button>
      <button onClick={removeFile} disabled={selectedFile < 0}> Remove selected file</button>
      <button onClick={analyzeWithAi} disabled={selectedFile < 0 || graphLoading}>
        {graphLoading ? 'Analyzing…' : 'Analyze with AI'}
      </button>
    </div>

    <div>
      {(selectedFile !== -1) ? `Selected File : ${uploadedFiles[selectedFile].name}  from   ${uploadedFiles[selectedFile].uploadedAt}` : ""}
    </div>

    {graphError && <div className="error-msg">{graphError}</div>}

    {graphData && (
      <div style={{ marginTop: 16 }}>
        <GraphView graph={graphData} />
      </div>
    )}

    {uploading && (
      <div className="progress-container">
        <div className="progress-bar-background">
          <div
            className="progress-bar-fill"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <small>{uploadProgress}%</small>
      </div>
    )}

    <h3 style={{ marginTop: 24 }}>Uploaded Files</h3>
    <div className="uploaded-files">
      {uploadedFiles.map((f,index) => (
        <div key={index} className={`uploaded-file-card ${selectedFile === index ? "selected" : ""}`} onClick={() => setSelectedFile(index)}>
          <p><strong>{f.name}</strong></p>
          <p>{(f.size / 1024).toFixed(1)} KB</p>
          <p>{new Date(f.uploadedAt).toLocaleString()}</p>
        </div>
      ))}
      {uploadedFiles.length === 0 && <p style={{color: '#666'}}>No files uploaded yet.</p>}
    </div>
  </div>
);
}
