import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import axios from "axios";
import './App.css';
import { predictCardiacInteraction, uploadFile, getFiles } from './apiService';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = ['xlsx', 'xls', 'csv'];
const FEATURE_GROUPS = {
  "Current Stats": ["LA_area_cm2", "LA_length_cm", "LA_volume_ml", "MV_annulus_mm", "LV_area_cm2", "LV_length_cm", "LV_volume_ml", "RR_interval_msec"],
  "Lag 1 (Previous)": ["LA_area_cm2_lag1", "LA_length_cm_lag1", "LA_volume_ml_lag1", "MV_annulus_mm_lag1", "LV_area_cm2_lag1", "LV_length_cm_lag1", "LV_volume_ml_lag1", "RR_interval_msec_lag1"],
  "Lag 2 (Two Steps Ago)": ["LA_area_cm2_lag2", "LA_length_cm_lag2", "LA_volume_ml_lag2", "MV_annulus_mm_lag2", "LV_area_cm2_lag2", "LV_length_cm_lag2", "LV_volume_ml_lag2", "RR_interval_msec_lag2"]
};

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

  const [mlFormData, setMlFormData] = useState(
    Object.values(FEATURE_GROUPS).flat().reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {})
  );
  const [mlResult, setMlResult] = useState(null);
  const [predicting, setPredicting] = useState(false);

  // New: in-memory lists and preview toggle
  const [lists, setLists] = useState([]);            // [{name, count}]
  const [showPreview, setShowPreview] = useState(false); // Toggle between preview and edit mode
  const [graphData, setGraphData] = useState(null);  // AI graph response
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState(null);

  // Medical / cardiovascular analysis
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [dependencies, setDependencies] = useState(null);
  const [depsLoading, setDepsLoading] = useState(false);
  const [depsError, setDepsError] = useState(null);

  function isNameLikeHeader(header) {
    if (!header) return false;
    const h = String(header).toLowerCase();
    return h.includes('name') || h.includes('patient');
  }

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
    setAnalysis(null);
    setAnalysisError(null);
    setDependencies(null);
    setDepsError(null);
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
    if (!Array.isArray(json) || json.length === 0) return [];
    const sliced = limit ? json.slice(0, limit) : json.slice();
    const headers = Object.keys(sliced[0] || {});
    const filteredHeaders = headers.filter(h => !isNameLikeHeader(h));

    // If there are no name-like columns, return as-is
    if (filteredHeaders.length === headers.length) {
      return sliced;
    }

    // Otherwise, strip name-like columns from all preview rows
    return sliced.map(row => {
      const out = {};
      filteredHeaders.forEach(h => {
        out[h] = row[h];
      });
      return out;
    });
  }

const handleMLPredict = async () => {
  setPredicting(true);
  setError(null);
  try {
    // Validate that rows exist and are not empty
    if (!rows || rows.length === 0) {
      setError("No data available. Please select a file and ensure it has data rows.");
      return;
    }
    
    // 'rows' is the array of data already loaded from your Node.js backend
    const response = await axios.post('http://localhost:8000/predict', rows, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    setMlResult(response.data); // This now contains predictions AND importance
    setError(null);
  } catch (err) {
    console.error("Prediction error:", err);
    const errorMsg = err?.response?.data?.detail || err?.message || "AI Analysis failed. Check if Python is running.";
    setError(errorMsg);
  } finally {
    setPredicting(false);
  }
};

  const fillFromRow = (row) => {
    const updatedForm = { ...mlFormData };
    Object.keys(row).forEach(key => {
      const formKey = key.replace(/ /g, '_'); // Convert "LA area cm2" to "LA_area_cm2"
      if (formKey in updatedForm) {
        updatedForm[formKey] = parseFloat(row[key]) || 0;
      }
    });
    setMlFormData(updatedForm);
    setSuccessMsg("AI form populated from selected row.");
  };

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
      // clear previous analysis when structure changes
      setAnalysis(null);
      setAnalysisError(null);
      setDependencies(null);
      setDepsError(null);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to load rows');
    }
  }

  async function runAnalysis() {
    const name = getSelectedFilename();
    if (!name) {
      setAnalysisError('No file selected for analysis.');
      return;
    }
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await axios.post('/api/analyze', null, { params: { name } });
      setAnalysis(res.data.analysis || null);
      setDependencies(null);
      setDepsError(null);
    } catch (err) {
      console.error(err);
      setAnalysis(null);
      setAnalysisError(err?.response?.data?.error || err.message || 'Failed to analyze data');
    } finally {
      setAnalyzing(false);
    }
  }

  async function runDependenciesAnalysis() {
    const name = getSelectedFilename();
    if (!name) {
      setDepsError('No file selected for dependency analysis.');
      return;
    }
    setDepsLoading(true);
    setDepsError(null);
    try {
      const res = await axios.post('/api/dependencies', null, { params: { name } });
      setDependencies(res.data.dependencies || null);
    } catch (err) {
      console.error(err);
      setDependencies(null);
      setDepsError(err?.response?.data?.error || err.message || 'Failed to analyze dependencies');
    } finally {
      setDepsLoading(false);
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
  <div className="app-root">
    <header className="app-header">
      <div className="app-title-block">
        <h1>CardioCasualty Lab</h1>
        <p className="app-subtitle">
          Upload hemodynamic or echo spreadsheets and explore systolic–diastolic patterns.
        </p>
      </div>
      <div className="app-heartline" />
    </header>

    <div className="excel-uploader">
    <h2 className="section-title">Upload dataset</h2>

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
    {analysisError && <div className="error-msg">{analysisError}</div>}
    {depsError && <div className="error-msg">{depsError}</div>}

    {/* Layout: left = data, right = analysis */}
    <div className="main-layout">
      <div className="data-panel">
        {/* Toggle button for preview/edit mode */}
        {selectedFile >= 0 && columns.length > 0 && (
          <div className="toggle-row">
            <button className="secondary-button" onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? 'Switch to Edit Mode' : 'Switch to Preview Mode'}
            </button>
          </div>
        )}

        {/* Preview Mode - Read-only view */}
        {showPreview && sheetName && previewRows && previewRows.length > 0 && (
          <div className="card preview-container">
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
              <div className="card add-row-card">
                <h4>Add measurement / row</h4>
                <div className="grid-form">
                  {columns.map(col => (
                    <div key={col} className="grid-form-field">
                      <label>{col}</label>
                      <input
                        value={newRow[col] ?? ''}
                        onChange={e => onChangeNewField(col, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <button className="primary-button" onClick={addRow}>Add Row</button>
              </div>
            )}

            {/* Editable table */}
            {columns.length > 0 && rows.length > 0 && (
              <div className="card crud-table">
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

                            <td className="row-actions">
                                <button className="secondary-button small" onClick={() => fillFromRow(r)}>Predict Interaction</button>
                            </td>

                        <td className="row-actions">
                          {editIndex === i ? (
                            <>
                              <button className="primary-button small" onClick={saveEdit}>Save</button>
                              <button className="secondary-button small" onClick={cancelEdit}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="secondary-button small" onClick={() => beginEdit(i)}>Edit</button>
                              <button className="danger-button small" onClick={() => deleteRowAt(i)}>Delete</button>
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
      </div>

      {/* Analysis panel */}
      <aside className="analysis-panel">

        {/* AI Prediction Section */}
            <div className="card ml-card" style={{ marginBottom: '16px', borderLeft: '4px solid #3b82f6' }}>
              <h3>AI Interaction Model</h3>
              <button 
                className="primary-button full-width" 
                onClick={handleMLPredict} 
                disabled={predicting}
              >
                {predicting ? "Computing AI..." : "Run AI Interaction Predictor"}
              </button>

              {mlResult && (
                <div className="ml-result-display">
                  <span className="ml-score-title">Predicted MR Area</span>
                  <strong className="ml-score-value">
                    {/* If single prediction, show the number */}
                    {typeof mlResult.mr_area_cm2[0] === 'number' 
                      ? mlResult.mr_area_cm2[0].toFixed(3) 
                      : "0.000"} cm²
                  </strong>
                  
                  {/* Medical context: Severity thresholds for MR Area */}
                  <div className={`badge ${mlResult.mr_area_cm2[0] > 0.4 ? 'badge-negative' : 'badge-positive'}`} style={{display: 'block', marginTop: '8px'}}>
                    {mlResult.mr_area_cm2[0] > 0.4 ? "Severe MR Signal" : "Mild/Moderate Signal"}
                  </div>

                  {/* Feature Importance / Dependencies */}
                  {mlResult.importance && mlResult.importance.length > 0 && (
                    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
                      <h5 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                        Feature Impact (How much each column affects the prediction)
                      </h5>
                      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {mlResult.importance.map((item, idx) => {
                            // Calculate percentage of total importance
                            const totalImportance = mlResult.importance.reduce((sum, i) => sum + i.score, 0);
                            const percentage = totalImportance > 0 ? (item.score / totalImportance * 100).toFixed(1) : 0;
                            
                            return (
                              <li key={idx} style={{ 
                                padding: '8px 0', 
                                borderBottom: idx < mlResult.importance.length - 1 ? '1px solid #f3f4f6' : 'none',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: '12px', fontWeight: '500', color: '#111827' }}>
                                    {item.feature.replace(/_/g, ' ')}
                                  </div>
                                  <div style={{ 
                                    width: '100%', 
                                    height: '4px', 
                                    backgroundColor: '#e5e7eb', 
                                    borderRadius: '2px',
                                    marginTop: '4px',
                                    overflow: 'hidden'
                                  }}>
                                    <div style={{
                                      width: `${percentage}%`,
                                      height: '100%',
                                      backgroundColor: idx < 3 ? '#3b82f6' : '#9ca3af',
                                      transition: 'width 0.3s ease'
                                    }} />
                                  </div>
                                </div>
                                <div style={{ 
                                  marginLeft: '12px', 
                                  fontSize: '11px', 
                                  color: '#6b7280',
                                  minWidth: '60px',
                                  textAlign: 'right'
                                }}>
                                  {item.score.toFixed(2)}
                                  <br />
                                  <span style={{ fontSize: '10px' }}>{percentage}%</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

        <div className="card">
          <h3>Cardiovascular analysis</h3>
          <p className="analysis-caption">
            Checks for atrial / ventricular terms and systolic–diastolic relationships.
          </p>
          <button
            className="primary-button full-width"
            onClick={runAnalysis}
            disabled={analyzing || !getSelectedFilename()}
          >
            {analyzing ? 'Analyzing…' : 'Run medical analysis'}
          </button>

          {analysis && analysis.isMedicalLike && (
            <button
              className="secondary-button full-width"
              style={{ marginTop: 8 }}
              onClick={runDependenciesAnalysis}
              disabled={depsLoading}
            >
              {depsLoading ? 'Analyzing data…' : 'Analyze data dependencies'}
            </button>
          )}

          {!analysis && !analyzing && (
            <p className="analysis-hint">
              Select an uploaded file and run the analysis to see if it looks like cardiovascular data.
            </p>
          )}

          {analysis && (
            <div className="analysis-results">
              <div className={`badge ${analysis.isMedicalLike ? 'badge-positive' : 'badge-neutral'}`}>
                {analysis.isMedicalLike ? 'Medical-like dataset detected' : 'No strong medical signal detected'}
              </div>

              <div className="analysis-section">
                <h4>Keywords</h4>
                <ul className="keyword-list">
                  {Object.values(analysis.keywords).map(stat => (
                    <li key={stat.keyword}>
                      <span className="keyword-label">{stat.keyword.toUpperCase()}</span>
                      <span className="keyword-meta">
                        {stat.hitCount} hits
                        {stat.inHeaders.length > 0 && ` · in headers: ${stat.inHeaders.join(', ')}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="analysis-section">
                <h4>Systole / Diastole axes</h4>
                <p>
                  <strong>Systolic columns:</strong> {analysis.systoleHeaders.length ? analysis.systoleHeaders.join(', ') : 'none detected'}
                  <br />
                  <strong>Diastolic columns:</strong> {analysis.diastoleHeaders.length ? analysis.diastoleHeaders.join(', ') : 'none detected'}
                </p>
              </div>

              {analysis.phaseDependencies && analysis.phaseDependencies.length > 0 && (
                <div className="analysis-section">
                  <h4>Co-occurring measurements</h4>
                  <p className="analysis-caption">
                    Columns that frequently appear in the same rows as systolic / diastolic values.
                  </p>
                  <ul className="dependency-list">
                    {analysis.phaseDependencies.slice(0, 8).map(dep => (
                      <li key={dep.header}>
                        <span>{dep.header}</span>
                        <span className="pill">{dep.coOccurrenceCount}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {dependencies && dependencies.pairs && dependencies.pairs.length > 0 && (
                <div className="analysis-section">
                  <h4>Strong column dependencies</h4>
                  <p className="analysis-caption">
                    Top correlations between numeric columns (|r|, strongest first).
                  </p>
                  <ul className="dependency-list">
                    {dependencies.pairs.slice(0, 10).map((pair, idx) => (
                      <li key={`${pair.colA}-${pair.colB}-${idx}`}>
                        <span>{pair.colA} ↔ {pair.colB}</span>
                        <span className="pill">
                          r={pair.correlation.toFixed(2)} · n={pair.samples}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="analysis-footer">
                <small>
                  Rows analyzed: {analysis.meta.totalRows} · Columns: {analysis.meta.totalHeaders}
                </small>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>

    <div className="button-group">
      <button className="primary-button" onClick={uploadSelectedFile} disabled={uploading}>
        {uploading ? `Uploading (${uploadProgress}%)` : "Upload file to server"}
      </button>
      <button className="secondary-button" onClick={() => { resetUI(); if (fileInputRef.current) fileInputRef.current._selectedFile = null; }}>
        Cancel upload
      </button>
      <button className="secondary-button" onClick={getFiles}> Refresh files </button>
      <button className="danger-button" onClick={removeFile} disabled={selectedFile < 0}> Remove selected file</button>
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

    <h3 className="section-title" style={{ marginTop: 24 }}>Uploaded series</h3>
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
  </div>
);
}
