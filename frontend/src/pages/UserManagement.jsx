import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Container, Typography, Card, CardContent, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, DialogContentText
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

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

  useEffect(() => {
    const fetchUsers = async () => {
      if (currentUser && ['Maintenance Manager', 'Supervisor'].includes(currentUser.role)) {
        try {
          const response = await api.get('/users');
          setUsers(response.data);
        } catch (err) { setError('Failed to fetch users.'); console.error(err); } 
        finally { setLoading(false); }
      } else {
        setLoading(false);
        setError("You don't have permission to view users.");
      }
    };
    fetchUsers();
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
      await api.delete(`/users/${userToDelete.id}`);
      setUsers(users.filter(user => user.id !== userToDelete.id));
      handleConfirmClose();
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete user.'); }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>User Management</Typography>
        {currentUser && currentUser.role === 'Maintenance Manager' && (
          <Button variant="contained" onClick={handleOpenAddDialog}>Add New User</Button>
        )}
      </Box>
      
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
        <DialogActions><Button onClick={handleClose}>Cancel</Button><Button onClick={handleSubmit}>{editingUser ? 'Save Changes' : 'Create User'}</Button></DialogActions>
      </Dialog>
      
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>{/*...confirm dialog jsx...*/}</Dialog>

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