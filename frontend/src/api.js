// src/api.js
import axios from 'axios';

// Create a new Axios instance with a base URL
const api = axios.create({
  baseURL: 'http://localhost:4000', // Our backend server
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