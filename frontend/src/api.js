import axios from 'axios';

const api = axios.create({
  // Make sure this is the correct public URL for your BACKEND from the "Ports" tab
  baseURL: 'https://plantmaint-backend.onrender.com', 
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