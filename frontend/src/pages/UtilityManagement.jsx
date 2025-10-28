// frontend/src/pages/UtilityManagement.jsx (Corrected for your backend)
import React, { useState, useEffect } from 'react';
import api from '../api'; // Your axios instance
import { useAuth } from '../context/AuthContext';
import {
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, DialogContentText
} from '@mui/material';
// Removed DeleteIcon as backend doesn't support delete yet
import AddIcon from '@mui/icons-material/Add';

// Updated initial state to match backend (keyword instead of threshold)
const initialFormState = { name: '', unit: '', keyword: '' };

function UtilityManagement() {
  const { user } = useAuth();
  const [utilities, setUtilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // State for Add Dialog
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);

  const fetchUtilities = async () => {
    try {
      setLoading(true);
      // --- FIX: Removed '/api' prefix ---
      const { data } = await api.get('/utilities');
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
    setError(''); // Clear previous errors
    setOpen(true);
  };

  const handleCloseDialog = () => {
    setOpen(false);
  };

  // --- Form & API Handlers ---
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    // Store keyword as lowercase for consistency, as backend does
    const processedValue = name === 'keyword' ? value.toLowerCase() : value;
    setFormData(prev => ({ ...prev, [name]: processedValue }));
  };

  const handleSubmit = async () => {
    // Basic validation
    if (!formData.name || !formData.unit || !formData.keyword) {
        setError('Name, Unit, and Keyword are required.');
        return;
    }
    try {
      setError(''); // Clear previous errors
      // --- FIX: Removed '/api' prefix ---
      // Backend expects name, unit, keyword
      await api.post('/utilities', formData);
      handleCloseDialog();
      fetchUtilities(); // Refresh the list
    } catch (err) {
      console.error("Error creating utility:", err);
      // Use error message from backend if available
      setError(err.response?.data?.message || 'Failed to create utility.');
    }
  };

  // --- Delete functionality removed as backend route is missing ---

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* --- Page Header --- */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          Utility Management
        </Typography>
        {/* Only Managers can add utilities based on backend */}
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

      {/* --- Add Utility Dialog --- */}
      <Dialog open={open} onClose={handleCloseDialog}>
        <DialogTitle>Add New Utility</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Define a utility to track (e.g., POWER). Technicians will report readings via WhatsApp using the 'Keyword'.
          </DialogContentText>
          {/* Show error inside the dialog */}
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
            required // Add required attribute
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
            required // Add required attribute
          />
          {/* --- FIX: Changed field to 'keyword' --- */}
          <TextField
            margin="dense"
            name="keyword"
            label="WhatsApp Keyword (e.g. power)"
            type="text"
            fullWidth
            variant="outlined"
            value={formData.keyword}
            onChange={handleFormChange}
            helperText="Single lowercase word used to log readings (e.g., 'power 123')"
            required // Add required attribute
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      {/* --- Delete Confirmation Dialog Removed --- */}

      {/* --- Utilities List --- */}
      {loading && <CircularProgress />}
      {/* Display general fetch errors outside the dialog */}
      {!loading && error && !open && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && utilities.map(utility => (
        <Card key={utility.id} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6">{utility.name}</Typography>
              <Typography color="text.secondary">Unit: {utility.unit}</Typography>
              {/* Display keyword used for WhatsApp */}
              <Typography variant="body2">WhatsApp Keyword: {utility.keyword || 'Not Set'}</Typography>
            </CardContent>
            {/* --- Delete Button Removed --- */}
          </Box>
        </Card>
      ))}
      {!loading && utilities.length === 0 && !error && (
          <Typography sx={{mt: 2}}>No utilities defined yet. Click 'Add New Utility' to create one.</Typography>
      )}
    </Container>
  );
}

export default UtilityManagement;