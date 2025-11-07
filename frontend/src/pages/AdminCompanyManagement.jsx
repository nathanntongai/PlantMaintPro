// frontend/src/pages/AdminCompanyManagement.jsx
// --- (UPDATED with "Delete" functionality) ---

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
  Button,
  Modal,
  Box,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  ButtonGroup // <-- NEW import
} from '@mui/material';

// Style for all modals
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

const WEAK_PASSWORD_MESSAGE = 'Password must be at least 8 characters long and contain at least one number and one special character.';

function AdminCompanyManagement() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // State for "Update Status" modal
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [newStatus, setNewStatus] = useState('');

  // State for "Create Company" modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newCompanyData, setNewCompanyData] = useState({
    companyName: '',
    userName: '',
    email: '',
    password: '',
    phoneNumber: ''
  });

  // --- NEW: State for "Delete Company" modal ---
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState(null);
  // --- END NEW ---

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null); // Clear success message on fetch
      const { data } = await api.get('/admin/companies');
      setCompanies(data);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
      setError(err.response?.data?.message || 'Failed to load company data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  // --- "Update Status" Modal Functions (Unchanged) ---
  const handleOpenStatusModal = (company) => {
    setSelectedCompany(company);
    setNewStatus(company.status);
    setStatusModalOpen(true);
    setError(null);
    setSuccess(null);
  };
  const handleCloseStatusModal = () => {
    setStatusModalOpen(false);
    setSelectedCompany(null);
  };
  const handleSaveStatus = async () => {
    if (!selectedCompany || !newStatus) return;
    try {
      setError(null);
      setSuccess(null);
      const { data } = await api.patch(
        `/admin/companies/${selectedCompany.id}/status`,
        { status: newStatus }
      );
      setCompanies(prevCompanies => 
        prevCompanies.map(c => 
          c.id === selectedCompany.id ? data.company : c
        )
      );
      setSuccess(data.message);
      handleCloseStatusModal();
    } catch (err) {
      console.error('Failed to update status:', err);
      setError(err.response?.data?.message || 'Failed to update status.');
    }
  };
  // --- End "Update Status" Functions ---


  // --- "Create Company" Modal Functions (Unchanged) ---
  const handleOpenCreateModal = () => {
    setCreateModalOpen(true);
    setError(null);
    setSuccess(null);
  };
  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    setNewCompanyData({ companyName: '', userName: '', email: '', password: '', phoneNumber: '' });
  };
  const handleCreateFormChange = (e) => {
    const { name, value } = e.target;
    setNewCompanyData(prevData => ({
      ...prevData,
      [name]: value
    }));
  };
  const isPasswordStrong = (password) => {
      if (!password || password.length < 8) return false;
      const hasNumber = /\d/.test(password);
      const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
      return hasNumber && hasSpecial;
  };
  const handleCreateSubmit = async () => {
    if (!isPasswordStrong(newCompanyData.password)) {
      setError(WEAK_PASSWORD_MESSAGE);
      return;
    }
    setError(null);
    try {
      const { data } = await api.post('/admin/companies', newCompanyData);
      setCompanies(prevCompanies => [...prevCompanies, data.company]);
      setSuccess(data.message);
      handleCloseCreateModal();
    } catch (err) {
      console.error('Failed to create company:', err);
      setError(err.response?.data?.message || 'Failed to create company.');
    }
  };
  // --- End "Create Company" Functions ---

  // --- NEW: "Delete Company" Modal Functions ---
  const handleOpenDeleteModal = (company) => {
    setCompanyToDelete(company);
    setDeleteModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handleCloseDeleteModal = () => {
    setCompanyToDelete(null);
    setDeleteModalOpen(false);
  };

  const handleConfirmDelete = async () => {
    if (!companyToDelete) return;
    try {
      setError(null);
      setSuccess(null);

      // Call our new DELETE route from Part A
      const { data } = await api.delete(`/admin/companies/${companyToDelete.id}`);

      // Remove the company from the table instantly
      setCompanies(prevCompanies => 
        prevCompanies.filter(c => c.id !== companyToDelete.id)
      );
      setSuccess(data.message);
      handleCloseDeleteModal();

    } catch (err) {
      console.error('Failed to delete company:', err);
      setError(err.response?.data?.message || 'Failed to delete company.');
      handleCloseDeleteModal(); // Close modal even on error
    }
  };
  // --- END NEW FUNCTIONS ---

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, mb: 3 }}>
        <Typography variant="h4" gutterBottom m={0}>
          Admin - Company Management
        </Typography>
        <Button 
          variant="contained" 
          color="primary"
          onClick={handleOpenCreateModal}
        >
          Create New Company
        </Button>
      </Box>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      {!loading && (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }} aria-label="company table">
            <TableHead>
              <TableRow>
                <TableCell>Company Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Company ID</TableCell>
                <TableCell>Created At</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {companies.map((company) => (
                <TableRow
                  key={company.id}
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell component="th" scope="row">
                    {company.name}
                  </TableCell>
                  <TableCell>
                    <Box 
                      sx={{ 
                        color: company.status === 'active' ? 'green' : 'red',
                        fontWeight: 'bold'
                      }}
                    >
                      {company.status}
                    </Box>
                  </TableCell>
                  <TableCell>{company.id}</TableCell>
                  <TableCell>{new Date(company.created_at).toLocaleDateString()}</TableCell>

                  {/* --- UPDATED: Actions Buttons --- */}
                  <TableCell align="right">
                    <ButtonGroup variant="outlined" size="small">
                      <Button 
                        onClick={() => handleOpenStatusModal(company)}
                      >
                        Manage
                      </Button>
                      <Button 
                        color="error"
                        onClick={() => handleOpenDeleteModal(company)}
                      >
                        Delete
                      </Button>
                    </ButtonGroup>
                  </TableCell>
                  {/* --- END UPDATE --- */}

                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* --- "Update Status" Modal (Unchanged) --- */}
      <Modal
        open={statusModalOpen}
        onClose={handleCloseStatusModal}
      >
        <Box sx={modalStyle}>
          <Typography variant="h6" component="h2">
            Manage Company: {selectedCompany?.name}
          </Typography>
          <FormControl fullWidth sx={{ mt: 3, mb: 2 }}>
            <InputLabel id="status-select-label">Status</InputLabel>
            <Select
              labelId="status-select-label"
              value={newStatus}
              label="Status"
              onChange={(e) => setNewStatus(e.target.value)}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
              <MenuItem value="suspended">Suspended</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
            <Button onClick={handleCloseStatusModal} sx={{ mr: 1 }}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSaveStatus}>
              Save
            </Button>
          </Box>
        </Box>
      </Modal>

      {/* --- "Create Company" Modal (Unchanged) --- */}
      <Modal
        open={createModalOpen}
        onClose={handleCloseCreateModal}
      >
        <Box sx={modalStyle}>
          <Typography variant="h6" component="h2">
            Create New Company
          </Typography>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          <TextField autoFocus margin="normal" required fullWidth label="Company Name" name="companyName" value={newCompanyData.companyName} onChange={handleCreateFormChange} />
          <TextField margin="normal" required fullWidth label="Manager's Full Name" name="userName" value={newCompanyData.userName} onChange={handleCreateFormChange} />
          <TextField margin="normal" required fullWidth label="Manager's Email" name="email" type="email" value={newCompanyData.email} onChange={handleCreateFormChange} />
          <TextField margin="normal" fullWidth label="Manager's WhatsApp (e.g., +254...)" name="phoneNumber" value={newCompanyData.phoneNumber} onChange={handleCreateFormChange} placeholder="+254712345678" />
          <TextField margin="normal" required fullWidth label="Initial Password" name="password" type="password" value={newCompanyData.password} onChange={handleCreateFormChange} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
            <Button onClick={handleCloseCreateModal} sx={{ mr: 1 }}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleCreateSubmit}>
              Create
            </Button>
          </Box>
        </Box>
      </Modal>

      {/* --- NEW: "Delete Company" Confirmation Modal --- */}
      <Modal
        open={deleteModalOpen}
        onClose={handleCloseDeleteModal}
      >
        <Box sx={modalStyle}>
          <Typography variant="h6" component="h2" color="error">
            Confirm Deletion
          </Typography>
          <Typography sx={{ mt: 2 }}>
            Are you sure you want to delete the company: 
            <strong> {companyToDelete?.name}</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1, fontWeight: 'bold' }}>
            This action is permanent and will delete all associated users, machines, and data.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
            <Button onClick={handleCloseDeleteModal} sx={{ mr: 1 }}>
              Cancel
            </Button>
            <Button 
              variant="contained" 
              color="error"
              onClick={handleConfirmDelete}
            >
              Delete
            </Button>
          </Box>
        </Box>
      </Modal>
      {/* --- END "Delete Company" Modal --- */}

    </Container>
  );
}

export default AdminCompanyManagement;