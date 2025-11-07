// frontend/src/context/AuthContext.jsx
// --- (UPDATED to store user's role) ---

import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api'; // Ensure this path is correct

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  // --- NEW STATE ---
  const [userRole, setUserRole] = useState(localStorage.getItem('userRole'));

  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('user');
    try {
      return storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
      console.error("Failed to parse stored user:", error);
      return null;
    }
  });

  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      localStorage.removeItem('token');
      delete api.defaults.headers.common['Authorization'];
    }

    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }

    // --- NEW EFFECT LOGIC ---
    if (userRole) {
      localStorage.setItem('userRole', userRole);
    } else {
      localStorage.removeItem('userRole');
    }
    // --- END NEW ---

  }, [token, user, userRole]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post('/login', { email, password });
      setToken(data.token);
      setUser(data.user);
      // --- NEW: Save the role ---
      setUserRole(data.user.role); 
      return data;
    } catch (error) {
      console.error('Login failed', error.response?.data || error.message);
      throw error.response?.data || new Error('Login failed');
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    // --- NEW: Clear the role ---
    setUserRole(null);
  };

  // --- UPDATED: Add userRole to the context value ---
  const value = {
    token,
    user,
    userRole, // <-- Added this
    login,
    logout,
    // We can add register, forgotPassword, etc. if needed
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};