// src/context/AuthContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  // NEW: State to hold the decoded user object from the token
  const [user, setUser] = useState(null);

  // NEW: useEffect to decode the token whenever it changes
  useEffect(() => {
    if (token) {
      try {
        // The token is in three parts separated by dots. The middle part is the payload.
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser(payload); // Set the user state with the decoded payload
      } catch (e) {
        console.error("Failed to decode token", e);
        // If token is invalid, clear it
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, [token]); // This effect runs whenever the 'token' state changes

  const login = (newToken) => {
    setToken(newToken);
    localStorage.setItem('token', newToken);
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('token');
  };

  // Provide the user object along with other values
  const contextValue = {
    token,
    user, // <-- Make the user object available to the app
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};