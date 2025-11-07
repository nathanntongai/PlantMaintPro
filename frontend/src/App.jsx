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
import ForgotPassword from './pages/Forgot';
import ResetPassword from './pages/Reset';  
import AdminCompanyManagement from './pages/AdminCompanyManagement';
import AdminUserManagement from './pages/AdminUserManagement';
import AdminDashboard from './pages/AdminDashboard';
import AdminReports from './pages/AdminReports';

function ProtectedRoutes() {
  const { token, userRole } = useAuth(); // Get token and role

  if (!token) {
    // If no token, redirect to login
    return <Navigate to="/login" />;
  }

  // If there IS a token, show the layout
  // We will handle the default redirect inside the layout
  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
}

function App() {
  const { token } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
      <Route path="/register" element={!token ? <Register /> : <Navigate to="/" />} />
      <Route path="/forgot-password" element={!token ? <ForgotPassword /> : <Navigate to="/" />} />
      <Route path="/reset-password/:token" element={!token ? <ResetPassword /> : <Navigate to="/" />} />
      
      <Route element={<ProtectedRoutes />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/machines" element={<MachineManagement />} />
        <Route path="/preventive-maintenance" element={<PreventiveMaintenance />} />
        <Route path="/user-management" element={<UserManagement />} />
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/job-orders" element={<JobOrderManagement />} />
        <Route path="/inspections" element={<MachineInspections />} />
        <Route path="/utilities" element={<UtilityManagement />} />
        <Route path="/admin/companies" element={<AdminCompanyManagement />} /><Route path="/admin/companies" element={<AdminCompanyManagement />} />
        <Route path="/admin/users" element={<AdminUserManagement />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/reports" element={<AdminReports />} />
      </Route>
    </Routes>
  );
}

export default App;