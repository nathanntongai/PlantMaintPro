// src/api.js
import axios from 'axios';

// Create a new Axios instance with a base URL
const api = axios.create({
  baseURL: 'https://refactored-disco-v57v9j64qrxfwq64-4000.app.github.dev/', // Our backend server
});

// Request interceptor
// This function will run before every request is sent
api.interceptors.request.use(
  (config) => {
    // Get the token from localStorage
    const token = localStorage.getItem('token');
    if (token) {
      // If the token exists, add it to the Authorization header
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config; // Return the modified request configuration
  },
  (error) => {
    // Handle request errors
    return Promise.reject(error);
  }
);

export default api;