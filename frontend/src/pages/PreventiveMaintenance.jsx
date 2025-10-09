// src/pages/PreventiveMaintenance.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Container, Typography, Card, CardContent, CardActions, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, DialogContentText
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

function PreventiveMaintenance() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // State for the main form dialog (Add/Edit)
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingTask, setEditingTask] = useState(null);
  
  // State for the delete confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasksResponse, machinesResponse] = await Promise.all([
          api.get('/preventive-maintenance'), api.get('/machines')
        ]);
        setTasks(tasksResponse.data);
        setMachines(machinesResponse.data);
      } catch (err) { setError('Failed to fetch data.'); console.error(err); } 
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const handleOpenAddDialog = () => {
    setEditingTask(null);
    setFormData({ machineId: '', taskDescription: '', frequencyDays: 30, startDate: new Date().toISOString().split('T')[0] });
    setOpen(true);
  };

  const handleOpenEditDialog = (task) => {
    setEditingTask(task);
    setFormData({ 
      machineId: task.machine_id, 
      taskDescription: task.task_description, 
      frequencyDays: task.frequency_days, 
      next_due_date: new Date(task.next_due_date).toISOString().split('T')[0] 
    });
    setOpen(true);
  };
  
  const handleClose = () => {
    setOpen(false);
    setEditingTask(null);
  };
  
  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async () => {
    try {
      if (editingTask) {
        const response = await api.patch(`/preventive-maintenance/${editingTask.id}`, formData);
        setTasks(tasks.map(t => t.id === editingTask.id ? response.data.task : t).sort((a,b) => new Date(a.next_due_date) - new Date(b.next_due_date)));
      } else {
        const response = await api.post('/preventive-maintenance', formData);
        setTasks([...tasks, response.data.task].sort((a,b) => new Date(a.next_due_date) - new Date(b.next_due_date)));
      }
      handleClose();
    } catch (err) { setError(err.response?.data?.message || 'An error occurred.'); }
  };
  
  const handleCompleteTask = async (taskId) => {
    try {
      const response = await api.post(`/preventive-maintenance/${taskId}/complete`);
      setTasks(currentTasks => 
        currentTasks.map(task => task.id === taskId ? response.data.task : task)
                    .sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date))
      );
    } catch (err) {
      setError('Failed to complete task.');
      console.error(err);
    }
  };
  
  const handleDeleteClick = (task) => { setTaskToDelete(task); setConfirmOpen(true); };
  const handleConfirmClose = () => { setConfirmOpen(false); setTaskToDelete(null); };
  const handleConfirmDelete = async () => {
    if (!taskToDelete) return;
    try {
      await api.delete(`/preventive-maintenance/${taskToDelete.id}`);
      setTasks(tasks.filter(t => t.id !== taskToDelete.id));
      handleConfirmClose();
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete task.'); }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>Preventive Maintenance Schedule</Typography>
        {user && user.role === 'Maintenance Manager' && (
          <Button variant="contained" onClick={handleOpenAddDialog}>Schedule New Task</Button>
        )}
      </Box>

      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>{editingTask ? 'Edit Task' : 'Schedule a New Task'}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="dense">
            <InputLabel>Machine</InputLabel>
            <Select name="machineId" value={formData.machineId || ''} label="Machine" onChange={handleInputChange}>
              {machines.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField margin="dense" name="taskDescription" label="Task Description" fullWidth value={formData.taskDescription || ''} onChange={handleInputChange} />
          <TextField margin="dense" name="frequencyDays" label="Frequency (in days)" type="number" fullWidth value={formData.frequencyDays || ''} onChange={handleInputChange} />
          {editingTask ? (
            <TextField margin="dense" name="next_due_date" label="Next Due Date" type="date" fullWidth value={formData.next_due_date || ''} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
          ) : (
            <TextField margin="dense" name="startDate" label="First Due Date" type="date" fullWidth value={formData.startDate || ''} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editingTask ? 'Save Changes' : 'Create'}</Button>
        </DialogActions>
      </Dialog>
      
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent><DialogContentText>Are you sure you want to delete this scheduled task?</DialogContentText></DialogContent>
        <DialogActions><Button onClick={handleConfirmClose}>Cancel</Button><Button onClick={handleConfirmDelete} color="error">Delete</Button></DialogActions>
      </Dialog>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && tasks.map(task => (
        <Card key={task.id} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="h6">{task.task_description}</Typography>
            <Typography color="text.secondary">Machine: {task.machine_name}</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>Frequency: Every {task.frequency_days} days</Typography>
            <Typography variant="body2">Next Due: <strong>{new Date(task.next_due_date).toLocaleDateString()}</strong></Typography>
            {task.last_performed_at && (<Typography variant="caption" color="text.secondary">Last Performed: {new Date(task.last_performed_at).toLocaleDateString()}</Typography>)}
          </CardContent>
          <CardActions>
            {user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
              <Button size="small" onClick={() => handleCompleteTask(task.id)}>Mark as Complete</Button>
            )}
            {user && user.role === 'Maintenance Manager' && (
              <>
                <IconButton onClick={() => handleOpenEditDialog(task)} color="primary"><EditIcon fontSize="small" /></IconButton>
                <IconButton onClick={() => handleDeleteClick(task)} color="error"><DeleteIcon fontSize="small" /></IconButton>
              </>
            )}
          </CardActions>
        </Card>
      ))}
    </Container>
  );
}

export default PreventiveMaintenance;