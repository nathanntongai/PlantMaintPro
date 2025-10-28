import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import PreventiveMaintenance from './pages/PreventiveMaintenance';
import UserManagement from './pages/UserManagement';
import MachineManagement from './pages/MachineManagement';
import JobOrderManagement from './pages/JobOrderManagement';
import MachineInspections from './pages/MachineInspections';
import UtilityManagement from './pages/UtilityManagement';

function ProtectedRoutes() {
  const { token } = useAuth();
  return token ? <MainLayout><Outlet /></MainLayout> : <Navigate to="/login" />;
}

function App() {
  const { token } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
      <Route path="/register" element={!token ? <Register /> : <Navigate to="/" />} />
      
      <Route element={<ProtectedRoutes />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/machines" element={<MachineManagement />} />
        <Route path="/preventive-maintenance" element={<PreventiveMaintenance />} />
        <Route path="/user-management" element={<UserManagement />} />
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/job-orders" element={<JobOrderManagement />} />
        <Route path="/inspections" element={<MachineInspections />} />
        <Route path="/utilities" element={<UtilityManagement />} />
      </Route>
    </Routes>
  );
}

export default App;