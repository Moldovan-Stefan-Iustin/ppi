import axios from "axios";

const NODE_API_URL = "http://localhost:5000"; // Node server -file handling
const PYTHON_API_URL = "http://localhost:8000"; // Python server - AI model

export const uploadFile = (formData) => axios.post(`${NODE_API_URL}/api/upload`, formData);
export const getFiles = () => axios.get(`${NODE_API_URL}/api/files`);
export const getRows = (name) => axios.get(`${NODE_API_URL}/api/rows`, { params: { name } });
export const addRow = (name, row) => axios.post(`${NODE_API_URL}/api/rows`, { row }, { params: { name } });
export const deleteRow = (name, index) => axios.delete(`${NODE_API_URL}/api/rows/${index}`, { params: { name } });
export const updateRow = (name, index, row) => axios.put(`${NODE_API_URL}/api/rows/${index}`, { row }, { params: { name } });

export const predictCardiacInteraction = async (rows) => {
  const response = await axios.post("http://localhost:8000/predict", rows);
  return response.data;
};