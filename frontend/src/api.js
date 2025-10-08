import axios from 'axios';

const api = axios.create({
  // Make sure this is the correct public URL for your BACKEND from the "Ports" tab
  baseURL: 'https://refactored-disco-v57v9j64qrxfwq64-4000.app.github.dev/', 
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;