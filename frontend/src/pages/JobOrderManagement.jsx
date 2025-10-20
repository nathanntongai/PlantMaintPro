// src/pages/JobOrderManagement.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import {
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';

const initialFormState = { machineId: '', description: '' };

function JobOrderManagement() {
  const { user } = useAuth();
  const [jobOrders, setJobOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    const fetchData = async () => {
      // Only fetch if user has permission
       if (user && ['Maintenance Manager', 'Supervisor'].includes(user.role)) {
            try {
                const [joResponse, machinesResponse] = await Promise.all([
                    api.get('/job-orders'),
                    api.get('/machines') // Needed for the dropdown
                ]);
                setJobOrders(joResponse.data);
                setMachines(machinesResponse.data);
            } catch (err) { setError('Failed to fetch data.'); console.error(err); }
            finally { setLoading(false); }
       } else {
           setLoading(false);
           setError("You don't have permission to view job orders.");
       }
    };
    fetchData();
  }, [user]); // Re-fetch if user changes

  const handleOpenAddDialog = () => { setFormData(initialFormState); setOpen(true); };
  const handleClose = () => setOpen(false);
  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async () => {
    try {
      const response = await api.post('/job-orders', formData);
      setJobOrders(currentOrders => [response.data.jobOrder, ...currentOrders]); // Add to top
      handleClose();
    } catch (err) { setError(err.response?.data?.message || 'Failed to create job order.'); }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>Job Orders</Typography>
        {/* Only managers and supervisors can create */}
        {user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
          <Button variant="contained" onClick={handleOpenAddDialog}>Create Job Order</Button>
        )}
      </Box>

      {/* Dialog for Creating a New Job Order */}
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Create New Job Order</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="dense">
            <InputLabel id="machine-select-label-jo">Machine</InputLabel>
            <Select
              labelId="machine-select-label-jo"
              name="machineId"
              value={formData.machineId}
              label="Machine"
              onChange={handleInputChange}
            >
              {machines.map(machine => (
                <MenuItem key={machine.id} value={machine.id}>{machine.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            name="description"
            label="Description of Work Needed"
            type="text"
            fullWidth
            multiline
            rows={4}
            variant="outlined"
            value={formData.description}
            onChange={handleInputChange}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Create</Button>
        </DialogActions>
      </Dialog>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && !error && (
        jobOrders.length > 0 ? (
          jobOrders.map(jo => (
            <Card key={jo.id} sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h6">Job Order #{jo.id} - {jo.machine_name}</Typography>
                <Typography color="text.secondary">
                  Status: {jo.status} | Requested By: {jo.requested_by_name} on {new Date(jo.requested_at).toLocaleDateString()}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{jo.description}</Typography>
                {/* Add Edit/Delete buttons later for Managers */}
              </CardContent>
            </Card>
          ))
        ) : (
          <Typography>No job orders found.</Typography>
        )
      )}
    </Container>
  );
}

export default JobOrderManagement;