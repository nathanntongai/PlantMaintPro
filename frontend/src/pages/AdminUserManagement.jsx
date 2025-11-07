// frontend/src/pages/AdminUserManagement.jsx
// --- (UPDATED with Manage User Modal) ---

import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Box,
  Button,
  Modal,
  TextField,
  Tabs,
  Tab
} from '@mui/material';

// Copied from backend/index.js for client-side validation
const WEAK_PASSWORD_MESSAGE = 'Password must be at least 8 characters long and contain at least one number and one special character.';

// This is the style for the pop-up modal
const modalStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 400,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};

function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // For success messages

  // --- State for the new modal ---
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [tabValue, setTabValue] = useState(0); // 0 for Details, 1 for Password
  const [editFormData, setEditFormData] = useState({ name: '', email: '', role: '' });
  const [newPassword, setNewPassword] = useState('');
  // --- End Modal State ---

  const fetchAllUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      const { data } = await api.get('/admin/users'); // Use .get() as fixed
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err.response?.data?.message || 'Failed to load user data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllUsers();
  }, []);

  // --- Modal Handler Functions ---
  const handleOpenModal = (user) => {
    setSelectedUser(user);
    setEditFormData({ name: user.name, email: user.email, role: user.role });
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedUser(null);
    setTabValue(0);
    setNewPassword('');
    setError(null);
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    setError(null);
    setSuccess(null);
  };

  const handleFormChange = (e) => {
    setEditFormData({
      ...editFormData,
      [e.target.name]: e.target.value
    });
  };

  const handleUpdateDetails = async () => {
    try {
      setError(null);
      setSuccess(null);
      const { data } = await api.patch(
        `/admin/users/${selectedUser.id}/details`, 
        editFormData
      );

      // Update the user in the main table
      setUsers(prevUsers => 
        prevUsers.map(u => u.id === selectedUser.id ? data.user : u)
      );
      setSuccess(data.message);
      handleCloseModal(); // Close on success

    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update details.');
    }
  };

  const isPasswordStrong = (password) => {
      if (!password || password.length < 8) return false;
      const hasNumber = /\d/.test(password);
      const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
      return hasNumber && hasSpecial;
  };

  const handleResetPassword = async () => {
    if (!isPasswordStrong(newPassword)) {
      setError(WEAK_PASSWORD_MESSAGE);
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      const { data } = await api.patch(
        `/admin/users/${selectedUser.id}/password`, 
        { newPassword }
      );

      setSuccess(data.message);
      setNewPassword(''); // Clear the field
      handleCloseModal(); // Close on success

    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password.');
    }
  };
  // --- End Modal Handlers ---

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" gutterBottom sx={{ mt: 3, mb: 3 }}>
        Admin - All Users
      </Typography>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      {!loading && !error && (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }} aria-label="all users table">
            <TableHead>
              <TableRow>
                <TableCell>User ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Phone Number</TableCell>
                <TableCell>Company</TableCell>
                {/* --- NEW: Actions Column --- */}
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow
                  key={user.id}
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell>{user.id}</TableCell>
                  <TableCell component="th" scope="row">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.phone_number || 'N/A'}</TableCell>
                  <TableCell>{user.company_name || 'N/A'}</TableCell>
                  {/* --- NEW: Manage Button --- */}
                  <TableCell align="right">
                    <Button 
                      variant="outlined" 
                      size="small"
                      onClick={() => handleOpenModal(user)}
                      disabled={user.role === 'admin'} // Optional: Disable managing yourself
                    >
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* --- NEW: Manage User Modal --- */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
      >
        <Box sx={modalStyle}>
          <Typography variant="h6" component="h2">
            Manage User: {selectedUser?.name}
          </Typography>

          <Box sx={{ borderBottom: 1, borderColor: 'divider', mt: 2 }}>
            <Tabs value={tabValue} onChange={handleTabChange}>
              <Tab label="Edit Details" />
              <Tab label="Reset Password" />
            </Tabs>
          </Box>

          {/* Tab 0: Edit Details */}
          <Box hidden={tabValue !== 0} sx={{ mt: 2 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              label="Full Name"
              name="name"
              value={editFormData.name}
              onChange={handleFormChange}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              label="Email"
              name="email"
              value={editFormData.email}
              onChange={handleFormChange}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              label="Role"
              name="role"
              value={editFormData.role}
              onChange={handleFormChange}
              helperText="e.g., Maintenance Manager, Supervisor, admin"
            />
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
              <Button onClick={handleCloseModal} sx={{ mr: 1 }}>Cancel</Button>
              <Button variant="contained" onClick={handleUpdateDetails}>Save Details</Button>
            </Box>
          </Box>

          {/* Tab 1: Reset Password */}
          <Box hidden={tabValue !== 1} sx={{ mt: 2 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              label="New Password"
              name="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
              <Button onClick={handleCloseModal} sx={{ mr: 1 }}>Cancel</Button>
              <Button variant="contained" color="warning" onClick={handleResetPassword}>Reset Password</Button>
            </Box>
          </Box>
        </Box>
      </Modal>
      {/* --- END MODAL --- */}

    </Container>
  );
}

export default AdminUserManagement;