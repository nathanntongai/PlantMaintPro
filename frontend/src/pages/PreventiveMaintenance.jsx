// src/pages/PreventiveMaintenance.jsx (Complete with PM Upload)

import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { saveAs } from 'file-saver';
import { 
  Container, Typography, Card, CardContent, CardActions, CircularProgress, Alert, Button, Box, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, DialogContentText,
  Input // Import Input for file upload
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';

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

  // NEW: State for Upload Dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');


  useEffect(() => {
    if (user && ['Maintenance Manager', 'Supervisor'].includes(user.role)) {
        const fetchData = async () => {
          setLoading(true);
          try {
            const [tasksResponse, machinesResponse] = await Promise.all([
              api.get('/preventive-maintenance'), 
              api.get('/machines')
            ]);
            setTasks(tasksResponse.data);
            setMachines(machinesResponse.data);
          } catch (err) { 
            setError('Failed to fetch data.'); 
            console.error(err); 
          } 
          finally { setLoading(false); }
        };
        fetchData();
    } else if (user) {
        setError("You do not have permission to view this page.");
        setLoading(false);
    }
  }, [user]);

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
      setError('');
      const response = await api.post(`/preventive-maintenance/${taskId}/complete`);
      setTasks(currentTasks => 
        currentTasks.map(task => 
          task.id === taskId ? response.data.task : task
        )
        .sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to complete task.');
      console.error(err);
    }
  };
  
  const handleDeleteClick = (task) => {
    setTaskToDelete(task);
    setConfirmOpen(true);
  };
  
  const handleConfirmClose = () => {
    setConfirmOpen(false);
    setTaskToDelete(null);
  };
  
  const handleConfirmDelete = async () => {
    if (!taskToDelete) return;
    try {
      setError('');
      await api.delete(`/preventive-maintenance/${taskToDelete.id}`);
      setTasks(tasks.filter(t => t.id !== taskToDelete.id));
      handleConfirmClose();
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete task.'); }
  };

  const handleDownloadTemplate = async () => {
    try {
        setError('');
        const response = await api.get('/templates/preventive-maintenance', {
            responseType: 'blob',
        });
        saveAs(response.data, 'pm_tasks_template.xlsx');
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
      const response = await api.post('/preventive-maintenance/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setUploadSuccess(response.data.message);
      // We need to fetch the machine names for the new tasks
      const newTasksWithNames = response.data.newTasks.map(task => ({
          ...task,
          machine_name: machines.find(m => m.id === task.machine_id)?.name || 'Unknown'
      }));
      setTasks(currentTasks => [...newTasksWithNames, ...currentTasks].sort((a,b) => new Date(a.next_due_date) - new Date(b.next_due_date)));
      setSelectedFile(null);
      
      setTimeout(() => {
         handleCloseUploadDialog();
      }, 2000);

    } catch (err) {
      console.error('Error uploading file:', err);
      setUploadError(err.response?.data?.message || 'File upload failed.');
    }
  };

  if (!user || !['Maintenance Manager', 'Supervisor'].includes(user.role)) {
     return (
        <Container maxWidth="lg">
             <Typography variant="h4" component="h1" gutterBottom>Preventive Maintenance</Typography>
             <Alert severity="error">{error || "You do not have permission to view this page."}</Alert>
        </Container>
     );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>Preventive Maintenance Schedule</Typography>
        {user && user.role === 'Maintenance Manager' && (
          <Box>
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
                onClick={handleOpenUploadDialog} // <-- This is now active
                sx={{ mr: 2 }}
            >
                Upload Excel
            </Button>
            <Button variant="contained" onClick={handleOpenAddDialog}>
                Schedule New Task
            </Button>
          </Box>
        )}
      </Box>

      {/* Add/Edit Dialog */}
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
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={handleConfirmClose}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent><DialogContentText>Are you sure you want to delete this scheduled task: "{taskToDelete?.task_description}"?</DialogContentText></DialogContent>
        <DialogActions>
            <Button onClick={handleConfirmClose}>Cancel</Button>
            <Button onClick={handleConfirmDelete} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* NEW: Upload Excel Dialog */}
      <Dialog open={uploadOpen} onClose={handleCloseUploadDialog}>
        <DialogTitle>Upload PM Tasks from Excel</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Select the completed `pm_tasks_template.xlsx` file to upload.
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

      {!loading && !error && (
        tasks.length > 0 ? (
            tasks.map(task => (
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
            ))
        ) : (
             <Typography>No preventive maintenance tasks scheduled.</Typography>
        )
      )}
    </Container>
  );
}

export default PreventiveMaintenance;