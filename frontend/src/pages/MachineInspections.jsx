// src/pages/MachineInspections.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import {
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel,
  RadioGroup, FormControlLabel, Radio, FormLabel
} from '@mui/material';

const initialFormState = { machineId: '', status: 'Okay', remarks: '' };

function MachineInspections() {
  const { user } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [dialogError, setDialogError] = useState('');

  useEffect(() => {
    // Only fetch data if user has permission to view the page
    if (user && ['Maintenance Manager', 'Supervisor', 'Maintenance Technician'].includes(user.role)) {
      const fetchData = async () => {
        setLoading(true);
        try {
          // Fetch both inspections and the list of machines for the dropdown
          const [inspectionsResponse, machinesResponse] = await Promise.all([
            api.get('/inspections'),
            api.get('/machines')
          ]);
          setInspections(inspectionsResponse.data);
          setMachines(machinesResponse.data);
        } catch (err) {
          setError('Failed to fetch data.');
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      fetchData();
    } else if (user) {
      // User is logged in but doesn't have permission
      setError("You do not have permission to view this page.");
      setLoading(false);
    }
  }, [user]); // Re-fetch if user changes

  const handleOpenAddDialog = () => {
    setFormData(initialFormState);
    setDialogError('');
    setOpen(true);
  };
  const handleClose = () => setOpen(false);
  
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    setDialogError('');
    if (!formData.machineId || !formData.status) {
      setDialogError("Please select a machine and a status.");
      return;
    }
    if (formData.status === 'Not Okay' && !formData.remarks) {
      setDialogError("Remarks are required if the status is 'Not Okay'.");
      return;
    }

    try {
      const response = await api.post('/inspections', formData);
      // Add the new inspection to the top of the list for instant UI update
      // We need to join the machine/user name manually
      const newInspection = {
          ...response.data.inspection,
          machine_name: machines.find(m => m.id === response.data.inspection.machine_id)?.name || 'Unknown',
          inspected_by_name: user.name 
      };
      setInspections(currentInspections => [newInspection, ...currentInspections]);
      handleClose();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Failed to log inspection.');
    }
  };

  // Do not render anything if the user is not authorized
  if (!user || !['Maintenance Manager', 'Supervisor', 'Maintenance Technician'].includes(user.role)) {
     return (
        <Container maxWidth="lg">
             <Typography variant="h4" component="h1" gutterBottom>Machine Inspections</Typography>
             <Alert severity="error">{error || "You do not have permission to view this page."}</Alert>
        </Container>
     );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>Machine Inspections</Typography>
        {/* All authorized roles can log an inspection */}
        <Button variant="contained" onClick={handleOpenAddDialog}>Log New Inspection</Button>
      </Box>

      {/* Dialog for Logging a New Inspection */}
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Log New Machine Inspection</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <FormControl fullWidth margin="dense" required>
            <InputLabel id="machine-select-label-inspection">Machine</InputLabel>
            <Select
              labelId="machine-select-label-inspection"
              name="machineId"
              value={formData.machineId}
              label="Machine"
              onChange={handleFormChange}
            >
              <MenuItem value=""><em>Select Machine...</em></MenuItem>
              {machines.map(machine => (
                <MenuItem key={machine.id} value={machine.id}>{machine.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          
          <FormControl component="fieldset" margin="dense" required>
            <FormLabel component="legend">Status</FormLabel>
            <RadioGroup row name="status" value={formData.status} onChange={handleFormChange}>
              <FormControlLabel value="Okay" control={<Radio />} label="Okay" />
              <FormControlLabel value="Not Okay" control={<Radio />} label="Not Okay" />
            </RadioGroup>
          </FormControl>
          
          <TextField
            margin="dense"
            name="remarks"
            label="Remarks"
            helperText={formData.status === 'Not Okay' ? "Required if status is 'Not Okay'" : "Optional"}
            type="text"
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={formData.remarks}
            onChange={handleFormChange}
            required={formData.status === 'Not Okay'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Log Inspection</Button>
        </DialogActions>
      </Dialog>

      {loading && <CircularProgress />}
      {/* Show page-level error if it's not a dialog error */}
      {error && !dialogError && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && (
        <Box>
            <Typography variant="h5" component="h2" gutterBottom sx={{mt: 2}}>Inspection History</Typography>
            {inspections.length > 0 ? (
            inspections.map(inspection => (
                <Card key={inspection.id} sx={{ mb: 2 }}>
                <CardContent>
                    <Typography variant="h6">{inspection.machine_name}</Typography>
                    <Typography variant="body1" color={inspection.status === 'Okay' ? 'green' : 'error'} sx={{fontWeight: 'bold'}}>
                        Status: {inspection.status}
                    </Typography>
                    <Typography color="text.secondary" sx={{fontSize: 14}}>
                        Inspected by {inspection.inspected_by_name} on {new Date(inspection.inspected_at).toLocaleString()}
                    </Typography>
                    {inspection.remarks && (
                        <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                            Remarks: {inspection.remarks}
                        </Typography>
                    )}
                </CardContent>
                </Card>
            ))
            ) : (
            <Typography>No inspection history found.</Typography>
            )}
        </Box>
      )}
    </Container>
  );
}

export default MachineInspections;