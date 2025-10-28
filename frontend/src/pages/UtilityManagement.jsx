// frontend/src/pages/UtilityManagement.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, DialogContentText
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';

const initialFormState = { name: '', unit: '', alert_threshold_percent: 15 };

function UtilityManagement() {
  const { user } = useAuth();
  const [utilities, setUtilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // State for Add/Edit Dialog
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  
  // State for Delete Dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [utilityToDelete, setUtilityToDelete] = useState(null);

  const fetchUtilities = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/api/utilities');
      setUtilities(data);
      setError('');
    } catch (err) {
      console.error("Error fetching utilities:", err);
      setError('Failed to fetch utilities.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUtilities();
  }, []);

  // --- Dialog Handlers ---
  const handleOpenAddDialog = () => {
    setFormData(initialFormState);
    setError('');
    setOpen(true);
  };

  const handleCloseDialog = () => {
    setOpen(false);
  };

  const handleDeleteClick = (utility) => {
    setUtilityToDelete(utility);
    setConfirmOpen(true);
  };

  const handleCloseConfirm = () => {
    setConfirmOpen(false);
    setUtilityToDelete(null);
  };

  // --- Form & API Handlers ---
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    try {
      setError('');
      // We already have the API set to capitalize the name
      await api.post('/api/utilities', formData);
      handleCloseDialog();
      fetchUtilities(); // Refresh the list
    } catch (err) {
      console.error("Error creating utility:", err);
      setError(err.response?.data?.msg || 'Failed to create utility.');
    }
  };

  const handleDelete = async () => {
    if (!utilityToDelete) return;
    try {
      setError('');
      await api.delete(`/api/utilities/${utilityToDelete.id}`);
      handleCloseConfirm();
      fetchUtilities(); // Refresh the list
    } catch (err) {
      console.error("Error deleting utility:", err);
      setError(err.response?.data?.msg || 'Failed to delete utility.');
      handleCloseConfirm();
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* --- Page Header --- */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          Utility Management
        </Typography>
        {user && user.role === 'Maintenance Manager' && (
          <Button 
            variant="contained" 
            startIcon={<AddIcon />} 
            onClick={handleOpenAddDialog}
            sx={{ mt: { xs: 2, md: 0 } }}
          >
            Add New Utility
          </Button>
        )}
      </Box>

      {/* --- Add/Edit Utility Dialog --- */}
      <Dialog open={open} onClose={handleCloseDialog}>
        <DialogTitle>Add New Utility</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Define a utility to track (e.g., POWER, WATER). Technicians will report this via WhatsApp using its name.
          </DialogContentText>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            autoFocus
            margin="dense"
            name="name"
            label="Utility Name (e.g. POWER)"
            type="text"
            fullWidth
            variant="outlined"
            value={formData.name}
            onChange={handleFormChange}
          />
          <TextField
            margin="dense"
            name="unit"
            label="Unit (e.g. kWh, m3, PSI)"
            type="text"
            fullWidth
            variant="outlined"
            value={formData.unit}
            onChange={handleFormChange}
          />
          <TextField
            margin="dense"
            name="alert_threshold_percent"
            label="Alert Threshold (%)"
            type="number"
            fullWidth
            variant="outlined"
            value={formData.alert_threshold_percent}
            onChange={handleFormChange}
            helperText="Send alert if reading spikes by this percent"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      {/* --- Delete Confirmation Dialog --- */}
      <Dialog open={confirmOpen} onClose={handleCloseConfirm}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the utility: <strong>{utilityToDelete?.name}</strong>? 
            This will also delete all of its historical readings. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfirm}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* --- Utilities List --- */}
      {loading && <CircularProgress />}
      {!loading && error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {!loading && !error && utilities.map(utility => (
        <Card key={utility.id} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6">{utility.name}</Typography>
              <Typography color="text.secondary">Unit: {utility.unit}</Typography>
              <Typography variant="body2">Alert Threshold: {utility.alert_threshold_percent}% Spike</Typography>
            </CardContent>
            {user && user.role === 'Maintenance Manager' && (
              <Box sx={{ pr: 2 }}>
                <IconButton onClick={() => handleDeleteClick(utility)} color="error">
                  <DeleteIcon />
                </IconButton>
              </Box>
            )}
          </Box>
        </Card>
      ))}
    </Container>
  );
}

export default UtilityManagement;