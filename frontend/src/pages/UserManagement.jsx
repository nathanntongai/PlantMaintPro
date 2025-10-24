// src/pages/UserManagement.jsx (Complete with User Upload)

import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { saveAs } from 'file-saver';
import { 
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, DialogContentText,
  Input // Import Input for the file upload
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload'; // Import upload icon

const roles = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const initialFormState = { name: '', email: '', password: '', role: '', phoneNumber: '' };

function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // State for Add/Edit Dialog
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingUser, setEditingUser] = useState(null);
  
  // State for Delete Dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  
  // State for Upload Dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  useEffect(() => {
    if (currentUser && ['Maintenance Manager', 'Supervisor'].includes(currentUser.role)) {
      const fetchUsers = async () => {
        setLoading(true);
        try {
          const response = await api.get('/users');
          setUsers(response.data);
        } catch (err) { 
          setError('Failed to fetch users.'); 
          console.error(err); 
        } 
        finally { setLoading(false); }
      };
      fetchUsers();
    } else if (currentUser) {
      setError("You do not have permission to view this page.");
      setLoading(false);
    }
  }, [currentUser]);

  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  const handleOpenAddDialog = () => { setEditingUser(null); setFormData(initialFormState); setOpen(true); };
  const handleOpenEditDialog = (user) => {
    setEditingUser(user);
    const cleanPhoneNumber = user.phone_number ? user.phone_number.replace('whatsapp:+', '') : '';
    setFormData({ name: user.name, email: user.email, role: user.role, phoneNumber: cleanPhoneNumber });
    setOpen(true);
  };
  const handleClose = () => setOpen(false);

  const handleSubmit = async () => {
    try {
      setError('');
      if (editingUser) {
        const response = await api.patch(`/users/${editingUser.id}`, formData);
        setUsers(users.map(u => u.id === editingUser.id ? response.data.user : u));
      } else {
        const response = await api.post('/users', formData);
        setUsers([...users, response.data.user]);
      }
      handleClose();
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred.');
    }
  };
  
  const handleDeleteClick = (user) => { setUserToDelete(user); setConfirmOpen(true); };
  const handleConfirmClose = () => { setConfirmOpen(false); setUserToDelete(null); };
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    try {
      setError('');
      await api.delete(`/users/${userToDelete.id}`);
      setUsers(users.filter(user => user.id !== userToDelete.id));
      handleConfirmClose();
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete user.'); }
  };

  const handleDownloadTemplate = async () => {
    try {
        setError('');
        const response = await api.get('/templates/users', {
            responseType: 'blob', // Expect a file
        });
        saveAs(response.data, 'users_template.xlsx');
    } catch (err) {
        console.error('Error downloading template:', err);
        setError('Failed to download template.');
    }
  };

  // --- NEW: Handlers for Upload Dialog ---
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
      const response = await api.post('/users/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setUploadSuccess(response.data.message);
      // Add new users to the state to refresh the list
      setUsers(currentUsers => [...response.data.newUsers, ...currentUsers]);
      setSelectedFile(null);
      
      // Close dialog on success after a delay
      setTimeout(() => {
         handleCloseUploadDialog();
      }, 2000);

    } catch (err) {
      console.error('Error uploading file:', err);
      setUploadError(err.response?.data?.message || 'File upload failed.');
    }
  };

  if (!currentUser || !['Maintenance Manager', 'Supervisor'].includes(currentUser.role)) {
     return (
        <Container maxWidth="lg">
             <Typography variant="h4" component="h1" gutterBottom>User Management</Typography>
             <Alert severity="error">{error || "You do not have permission to view this page."}</Alert>
        </Container>
     );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>User Management</Typography>
        <Box>
            {currentUser && currentUser.role === 'Maintenance Manager' && (
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
                        onClick={handleOpenUploadDialog} // Activate the button
                        sx={{ mr: 2 }}
                    >
                        Upload Excel
                    </Button>
                    <Button 
                        variant="contained" 
                        onClick={handleOpenAddDialog}
                    >
                        Add New User
                    </Button>
                </>
            )}
        </Box>
      </Box>
      
      {/* Add/Edit Dialog */}
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>{editingUser ? 'Edit User' : 'Add a New Team Member'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" name="name" label="Full Name" type="text" fullWidth variant="standard" value={formData.name || ''} onChange={handleInputChange} />
          <TextField margin="dense" name="email" label="Email Address" type="email" fullWidth variant="standard" value={formData.email || ''} onChange={handleInputChange} />
          {!editingUser && <TextField margin="dense" name="password" label="Initial Password" type="password" fullWidth variant="standard" value={formData.password || ''} onChange={handleInputChange} />}
          <TextField margin="dense" name="phoneNumber" label="Phone Number (e.g., +254...)" type="text" fullWidth variant="standard" value={formData.phoneNumber || ''} onChange={handleInputChange} />
          <FormControl fullWidth margin="dense">
            <InputLabel id="role-select-label">Role</InputLabel>
            <Select labelId="role-select-label" name="role" value={formData.role || ''} label="Role" onChange={handleInputChange}>
              {roles.map(role => <MenuItem key={role} value={role}>{role}</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editingUser ? 'Save Changes' : 'Create User'}</Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the user "{userToDelete?.name}"?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleConfirmClose}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* NEW: Upload Excel Dialog */}
      <Dialog open={uploadOpen} onClose={handleCloseUploadDialog}>
        <DialogTitle>Upload Users from Excel</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Select the completed `users_template.xlsx` file to upload.
            New users will be created with the details from the file.
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
      
      {!loading && !error && users.map(user => (
        <Card key={user.id} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                    <Typography variant="h6">{user.name}</Typography>
                    <Typography color="text.secondary">{user.role}</Typography>
                    <Typography variant="body2">{user.email}</Typography>
                    <Typography variant="body2">{user.phone_number}</Typography>
                </CardContent>
                {currentUser && currentUser.role === 'Maintenance Manager' && user.id !== currentUser.userId && (
                    <Box sx={{ pr: 2 }}>
                        <IconButton onClick={() => handleOpenEditDialog(user)} color="primary"><EditIcon /></IconButton>
                        <IconButton onClick={() => handleDeleteClick(user)} color="error"><DeleteIcon /></IconButton>
                    </Box>
                )}
            </Box>
        </Card>
      ))}
    </Container>
  );
}

export default UserManagement;