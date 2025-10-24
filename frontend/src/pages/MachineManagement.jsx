// src/pages/MachineManagement.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { saveAs } from 'file-saver'; // Import file-saver
import { 
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, DialogContentText
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download'; // Import download icon

const initialFormState = { name: '', location: '' };

function MachineManagement() {
  const { user } = useAuth();
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingMachine, setEditingMachine] = useState(null);
  
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [machineToDelete, setMachineToDelete] = useState(null);

  useEffect(() => {
    // Check for user and role before fetching
    if (user && ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'].includes(user.role)) {
        const fetchMachines = async () => {
          setLoading(true);
          try {
            const response = await api.get('/machines');
            setMachines(response.data);
          } catch (err) { setError('Failed to fetch machines.'); console.error(err); } 
          finally { setLoading(false); }
        };
        fetchMachines();
    } else if (user) {
        setError("You do not have permission to view this page.");
        setLoading(false);
    }
  }, [user]);

  const handleOpenAddDialog = () => { setEditingMachine(null); setFormData(initialFormState); setOpen(true); };
  const handleOpenEditDialog = (machine) => { setEditingMachine(machine); setFormData({ name: machine.name, location: machine.location }); setOpen(true); };
  const handleClose = () => setOpen(false);

  const handleSubmit = async () => {
    try {
      setError('');
      if (editingMachine) {
        const response = await api.patch(`/machines/${editingMachine.id}`, formData);
        setMachines(machines.map(m => m.id === editingMachine.id ? response.data.machine : m));
      } else {
        const response = await api.post('/machines', formData);
        setMachines(currentMachines => [response.data.machine, ...currentMachines]); // Add to top
      }
      handleClose();
    } catch (err) { setError(err.response?.data?.message || 'An error occurred.'); }
  };
  
  const handleDeleteClick = (machine) => { setMachineToDelete(machine); setConfirmOpen(true); };
  const handleConfirmClose = () => { setConfirmOpen(false); setMachineToDelete(null); };
  const handleConfirmDelete = async () => {
    if (!machineToDelete) return;
    try {
      setError('');
      await api.delete(`/machines/${machineToDelete.id}`);
      setMachines(machines.filter(m => m.id !== machineToDelete.id));
      handleConfirmClose();
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete machine.'); }
  };

  // NEW: Function to download the Excel template
  const handleDownloadTemplate = async () => {
    try {
        setError('');
        const response = await api.get('/templates/equipment', {
            responseType: 'blob', // Important: tell axios to expect a file
        });
        // Use file-saver to save the blob as a file
        saveAs(response.data, 'equipment_template.xlsx');
    } catch (err) {
        console.error('Error downloading template:', err);
        setError('Failed to download template.');
    }
  };

  // Don't render if not authorized
  if (!user || !['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'].includes(user.role)) {
     return (
        <Container maxWidth="lg">
             <Typography variant="h4" component="h1" gutterBottom>Machine Management</Typography>
             <Alert severity="error">{error || "You do not have permission to view this page."}</Alert>
        </Container>
     );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>Machine Management</Typography>
        <Box>
            {/* NEW: Download and Upload Buttons */}
            {user && user.role === 'Maintenance Manager' && (
                <>
                    <Button 
                        variant="outlined" 
                        startIcon={<DownloadIcon />} 
                        onClick={handleDownloadTemplate}
                        sx={{ mr: 2 }}
                    >
                        Download Template
                    </Button>
                    {/* We'll add the Upload button's logic next */}
                    <Button 
                        variant="contained" 
                        onClick={handleOpenAddDialog}
                    >
                        Add New Machine
                    </Button>
                </>
            )}
        </Box>
      </Box>
      
      {/* Add/Edit Dialog */}
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>{editingMachine ? 'Edit Machine' : 'Add a New Machine'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" name="name" label="Machine Name" type="text" fullWidth variant="standard" value={formData.name} onChange={(e) => setFormData({...formData, name: e.g.value})} />
          <TextField margin="dense" name="location" label="Location" type="text" fullWidth variant="standard" value={formData.location} onChange={(e) => setFormData({...formData, location: e.g.value})} />
        </DialogContent>
        <DialogActions><Button onClick={handleClose}>Cancel</Button><Button onClick={handleSubmit}>{editingMachine ? 'Save Changes' : 'Create Machine'}</Button></DialogActions>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent><DialogContentText>Are you sure you want to delete the machine "{machineToDelete?.name}"?</DialogContentText></DialogContent>
        <DialogActions><Button onClick={handleConfirmClose}>Cancel</Button><Button onClick={handleConfirmDelete} color="error">Delete</Button></DialogActions>
      </Dialog>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {!loading && !error && machines.map(machine => (
        <Card key={machine.id} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6">{machine.name}</Typography>
              <Typography color="text.secondary">{machine.location}</Typography>
            </CardContent>
            {user && user.role === 'Maintenance Manager' && (
              <Box sx={{ pr: 2 }}>
                <IconButton onClick={() => handleOpenEditDialog(machine)} color="primary"><EditIcon /></IconButton>
                <IconButton onClick={() => handleDeleteClick(machine)} color="error"><DeleteIcon /></IconButton>
              </Box>
            )}
          </Box>
        </Card>
      ))}
    </Container>
  );
}

export default MachineManagement;