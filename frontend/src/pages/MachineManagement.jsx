import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { saveAs } from 'file-saver';
import { 
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, DialogContentText, Input
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';

const initialFormState = { name: '', location: '' };

function MachineManagement() {
  const { user } = useAuth();
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // State for Add/Edit Dialog
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingMachine, setEditingMachine] = useState(null);
  
  // State for Delete Dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [machineToDelete, setMachineToDelete] = useState(null);

  // State for Upload Dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  useEffect(() => {
    // Check for user and role before fetching
    if (user && ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'].includes(user.role)) {
        const fetchMachines = async () => {
          setLoading(true);
          try {
            const response = await api.get('/machines');
            setMachines(response.data);
          } catch (err) { 
            setError('Failed to fetch machines.'); 
            console.error(err); 
          } 
          finally { setLoading(false); }
        };
        fetchMachines();
    } else if (user) {
        setError("You do not have permission to view this page.");
        setLoading(false);
    }
  }, [user]);

  // --- Handlers for Add/Edit Dialog ---
  const handleOpenAddDialog = () => { 
    setEditingMachine(null); 
    setFormData(initialFormState); 
    setOpen(true); 
  };
  const handleOpenEditDialog = (machine) => { 
    setEditingMachine(machine); 
    setFormData({ name: machine.name, location: machine.location }); 
    setOpen(true); 
  };
  const handleClose = () => setOpen(false);

  const handleSubmit = async () => {
    try {
      setError('');
      if (editingMachine) {
        const response = await api.patch(`/machines/${editingMachine.id}`, formData);
        setMachines(machines.map(m => m.id === editingMachine.id ? response.data.machine : m));
      } else {
        const response = await api.post('/machines', formData);
        setMachines(currentMachines => [response.data.machine, ...currentMachines]);
      }
      handleClose();
    } catch (err) { 
      setError(err.response?.data?.message || 'An error occurred.'); 
    }
  };
  
  // --- Handlers for Delete Dialog ---
  const handleDeleteClick = (machine) => { 
    setMachineToDelete(machine); 
    setConfirmOpen(true); 
  };
  const handleConfirmClose = () => { 
    setConfirmOpen(false); 
    setMachineToDelete(null); 
  };
  const handleConfirmDelete = async () => {
    if (!machineToDelete) return;
    try {
      setError('');
      await api.delete(`/machines/${machineToDelete.id}`);
      setMachines(machines.filter(m => m.id !== machineToDelete.id));
      handleConfirmClose();
    } catch (err) { 
      setError(err.response?.data?.message || 'Failed to delete machine.'); 
    }
  };

  // --- Handlers for Template Download ---
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

  // --- Handlers for Upload Dialog ---
  const handleOpenUploadDialog = () => {
    setSelectedFile(null);
    setUploadError('');
    setUploadSuccess('');
    setUploadOpen(true);
  };
  const handleCloseUploadDialog = () => setUploadOpen(false);
  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };
  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      setUploadError('Please select a file first.');
      return;
    }
    
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      setUploadError('');
      setUploadSuccess('');
      const response = await api.post('/machines/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setUploadSuccess(response.data.message);
      // Add new machines to the state to refresh the list
      setMachines(currentMachines => [...response.data.newMachines, ...currentMachines]);
      setSelectedFile(null); // Clear the file input
      
      // Optional: Close dialog on success after a delay
      setTimeout(() => {
         handleCloseUploadDialog();
      }, 2000);

    } catch (err) {
      console.error('Error uploading file:', err);
      setUploadError(err.response?.data?.message || 'File upload failed.');
    }
  };

  // Do not render if not authorized
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
            {user && user.role === 'Maintenance Manager' && (
                <>
                    <Button 
                        variant="outlined" 
                        startIcon={<DownloadIcon />} 
                        onClick={handleDownloadTemplate}
                        sx={{ mr: 1 }}
                    >
                        Template
                    </Button>
                    <Button 
                        variant="outlined" 
                        startIcon={<UploadIcon />} 
                        onClick={handleOpenUploadDialog}
                        sx={{ mr: 2 }}
                    >
                        Upload Excel
                    </Button>
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
          <TextField 
            autoFocus 
            margin="dense" 
            name="name" 
            label="Machine Name" 
            type="text" 
            fullWidth 
            variant="standard" 
            value={formData.name || ''} 
            onChange={(e) => setFormData({...formData, name: e.target.value})} 
          />
          <TextField 
            margin="dense" 
            name="location" 
            label="Location" 
            type="text" 
            fullWidth 
            variant="standard" 
            value={formData.location || ''} 
            onChange={(e) => setFormData({...formData, location: e.target.value})} 
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editingMachine ? 'Save Changes' : 'Create Machine'}</Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the machine "{machineToDelete?.name}"?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleConfirmClose}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Upload Excel Dialog */}
      <Dialog open={uploadOpen} onClose={handleCloseUploadDialog}>
        <DialogTitle>Upload Equipment from Excel</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Select the completed `equipment_template.xlsx` file to upload.
            Ensure you have not changed the column headers.
          </DialogContentText>
          <Input
            type="file"
            onChange={handleFileChange}
            sx={{ mt: 2 }}
            inputProps={{ accept: ".xlsx" }}
          />
          {uploadError && <Alert severity="error" sx={{ mt: 2 }}>{uploadError}</Alert>}
          {uploadSuccess && <Alert severity="success" sx={{ mt: 2 }}>{uploadSuccess}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseUploadDialog}>Close</Button>
          <Button onClick={handleUploadSubmit} variant="contained">Upload File</Button>
        </DialogActions>
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