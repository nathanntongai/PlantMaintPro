// src/pages/UserManagement.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, DialogContentText
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

// UPDATED: Added 'Maintenance Manager'
const roles = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const initialFormState = { name: '', email: '', password: '', role: '', phoneNumber: '' };

function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingUser, setEditingUser] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  useEffect(() => { /* ... existing useEffect logic ... */ }, []);

  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  const handleOpenAddDialog = () => { setEditingUser(null); setFormData(initialFormState); setOpen(true); };
  const handleOpenEditDialog = (user) => { /* ... existing edit dialog logic ... */ };
  const handleClose = () => setOpen(false);
  const handleSubmit = async () => { /* ... existing submit logic ... */ };
  const handleDeleteClick = (user) => { setUserToDelete(user); setConfirmOpen(true); };
  const handleConfirmClose = () => { setConfirmOpen(false); setUserToDelete(null); };
  const handleConfirmDelete = async () => { /* ... existing delete logic ... */ };

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>User Management</Typography>
        {/* UPDATED: Condition to show button only to manager */}
        {currentUser && currentUser.role === 'Maintenance Manager' && (
          <Button variant="contained" onClick={handleOpenAddDialog}>Add New User</Button>
        )}
      </Box>
      
      <Dialog open={open} onClose={handleClose}>{/* ... existing dialog code ... */}</Dialog>
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>{/* ... existing confirm dialog code ... */}</Dialog>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {!loading && users.map(user => (
        <Card key={user.id} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                    <Typography variant="h6">{user.name}</Typography>
                    <Typography color="text.secondary">{user.role}</Typography>
                    <Typography variant="body2">{user.email}</Typography>
                    <Typography variant="body2">{user.phone_number}</Typography>
                </CardContent>
                {/* UPDATED: Condition to show buttons only to manager */}
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