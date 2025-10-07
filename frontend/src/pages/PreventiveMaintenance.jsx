// src/pages/PreventiveMaintenance.jsx
import React, { useState, useEffect } from 'react';
import api from '../api';
import { 
  Container, Typography, Card, CardContent, CardActions, CircularProgress, Alert, Button, Box,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';

function PreventiveMaintenance() {
  const [tasks, setTasks] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    machineId: '', taskDescription: '', frequencyDays: 30, startDate: new Date().toISOString().split('T')[0]
  });

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

  const handleClickOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setNewTask(prevState => ({ ...prevState, [name]: value }));
  };

  const handleCreateTask = async () => {
    try {
      const response = await api.post('/preventive-maintenance', newTask);
      setTasks(currentTasks => [response.data.task, ...currentTasks].sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date)));
      handleClose();
    } catch (err) { setError('Failed to create task.'); console.error(err); }
  };
  
  // NEW: Function to handle completing a task
  const handleCompleteTask = async (taskId) => {
    try {
      const response = await api.post(`/preventive-maintenance/${taskId}/complete`);
      // Replace the old task with the updated one from the API response
      setTasks(currentTasks => 
        currentTasks.map(task => task.id === taskId ? response.data.task : task)
                    .sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date))
      );
    } catch (err) {
      setError('Failed to complete task.');
      console.error(err);
    }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>Preventive Maintenance Schedule</Typography>
        <Button variant="contained" onClick={handleClickOpen}>Schedule New Task</Button>
      </Box>

      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Schedule a New Maintenance Task</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="dense"><InputLabel id="machine-select-label">Machine</InputLabel><Select labelId="machine-select-label" name="machineId" value={newTask.machineId} label="Machine" onChange={handleInputChange}>{machines.map(machine => (<MenuItem key={machine.id} value={machine.id}>{machine.name}</MenuItem>))}</Select></FormControl>
          <TextField margin="dense" name="taskDescription" label="Task Description" type="text" fullWidth variant="outlined" value={newTask.taskDescription} onChange={handleInputChange} />
          <TextField margin="dense" name="frequencyDays" label="Frequency (in days)" type="number" fullWidth variant="outlined" value={newTask.frequencyDays} onChange={handleInputChange} />
          <TextField margin="dense" name="startDate" label="First Due Date" type="date" fullWidth variant="outlined" value={newTask.startDate} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
        </DialogContent>
        <DialogActions><Button onClick={handleClose}>Cancel</Button><Button onClick={handleCreateTask}>Create</Button></DialogActions>
      </Dialog>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && !error && (
        tasks.length > 0 ? (
          tasks.map(task => (
            <Card key={task.id} sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h6">{task.task_description}</Typography>
                <Typography color="text.secondary">Machine: {task.machine_name}</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>Frequency: Every {task.frequency_days} days</Typography>
                <Typography variant="body2">Next Due: <strong>{new Date(task.next_due_date).toLocaleDateString()}</strong></Typography>
                {/* NEW: Display the last performed date if it exists */}
                {task.last_performed_at && (
                    <Typography variant="caption" color="text.secondary">
                        Last Performed: {new Date(task.last_performed_at).toLocaleDateString()}
                    </Typography>
                )}
              </CardContent>
              {/* NEW: Add CardActions to hold the button */}
              <CardActions>
                <Button size="small" onClick={() => handleCompleteTask(task.id)}>Mark as Complete</Button>
              </CardActions>
            </Card>
          ))
        ) : (
          <Typography>No preventive maintenance tasks scheduled.</Typography>
        )
      )}
    </Container>
  );
}

export default PreventiveMaintenance;