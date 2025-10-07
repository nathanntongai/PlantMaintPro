import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import PreventiveMaintenance from './pages/PreventiveMaintenance';
import UserManagement from './pages/UserManagement';

// A component to protect our routes
function ProtectedRoutes() {
  const { token } = useAuth();
  // If there's a token, render the MainLayout which in turn renders the page content (Outlet)
  // Otherwise, navigate back to the login page
  return token ? <MainLayout><Outlet /></MainLayout> : <Navigate to="/login" />;
}

function App() {
  const { token } = useAuth();

  return (
    <Routes>
      <Route 
        path="/login" 
        element={!token ? <Login /> : <Navigate to="/" />} 
      />
      <Route 
        path="/register" 
        element={!token ? <Register /> : <Navigate to="/" />} 
      />
      
      {/* All protected routes will be children of this route */}
      <Route element={<ProtectedRoutes />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/preventive-maintenance" element={<PreventiveMaintenance />} />
        <Route path="/user-management" element={<UserManagement />} />
        {/* The default route for logged-in users */}
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Route>
    </Routes>
  );
}

export default App;