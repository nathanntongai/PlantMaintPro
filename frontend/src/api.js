// frontend/src/api.js
// --- (UPDATED to be environment-aware) ---

import axios from 'axios';

// Vite exposes your .env variables on 'import.meta.env'
const baseURL = import.meta.env.VITE_API_BASE_URL;

// A small check to make sure the variable is set
if (!baseURL) {
  console.error("VITE_API_BASE_URL is not set! Check your .env files.");
}

const api = axios.create({
  baseURL: baseURL,
});

export default api;