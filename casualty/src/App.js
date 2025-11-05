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
        setPreviewRows(json.slice(0, 10));
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
      getFiles();
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
      setSuccessMsg("File has been deleted successfully")
    }catch(err){
      console.log(err);
      setError(err?.response?.data?.error || err.message || "File removal failed");
    }finally{
      setSelectedFile(-1);
    };
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

    {sheetName && (
      <div className="preview-container">
        <strong>Preview (sheet: {sheetName}) — first {previewRows?.length ?? 0} rows</strong>
        <table>
          <thead>
            <tr>
              {previewRows && Object.keys(previewRows[0] || {}).map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(previewRows || []).map((row, i) => (
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

    <div className="button-group">

      <button onClick={getFiles}> Show </button>

      <button onClick={removeFile}> Remove file</button>

      <button onClick={uploadSelectedFile} disabled={uploading}>
        {uploading ? `Uploading (${uploadProgress}%)` : "Upload file to server"}
      </button>

      <button onClick={() => { resetUI(); if (fileInputRef.current) fileInputRef.current._selectedFile = null; }}>
        Cancel upload
      </button>
    </div>

    <div>
      {(selectedFile !== -1) ? `Selected File : ${uploadedFiles[selectedFile].name}  from   ${uploadedFiles[selectedFile].uploadedAt}` : ""}
    </div>

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

    {successMsg && <div className="success-msg">{successMsg}</div>}

    <div className="uploaded-files">
        {uploadedFiles.map((f,index) => (
          <div key={index} className={`uploaded-file-card ${selectedFile === index ? "selected" : ""}`} onClick={() => setSelectedFile(index)}>
            <p>{f.name}</p>
            <p>{(f.size / 1024).toFixed(1)} KB</p>
            <p>{new Date(f.uploadedAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
  </div>
);
}
