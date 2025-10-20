import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import KpiCard from '../components/KpiCard';
import LineChart from '../components/LineChart';
import {
  Container, Typography, Button, Box, Card, CardContent, CardActions,
  CircularProgress, Alert, Grid, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel
} from '@mui/material';

function Dashboard() {
  const { user, logout } = useAuth(); // Get the full user object
  const [breakdowns, setBreakdowns] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // State for the Report Breakdown Dialog
  const [machines, setMachines] = useState([]); // Need machine list for dropdown
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [newBreakdownData, setNewBreakdownData] = useState({ machineId: '', description: '' });
  const [dialogError, setDialogError] = useState(''); // Separate error state for dialog

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return; // Don't fetch if user isn't loaded yet

      setLoading(true);
      setError(''); // Clear previous page errors
      try {
        // Fetch data required by all roles
        const promises = [
          api.get('/breakdowns'), // Fetch breakdowns
          api.get('/machines')    // Fetch machines for the form dropdown
        ];
        
        // Only fetch KPIs and Chart data if user has permission
        const canViewAnalytics = user && ['Maintenance Manager', 'Supervisor'].includes(user.role);
        if (canViewAnalytics) {
          promises.push(api.get('/dashboard/kpis'));
          // Attempt to fetch chart data, default to utilityId=1, days=30
          // In a real app, you might want a user setting or default utility
          promises.push(api.get('/charts/utility-consumption?utilityId=1&days=30'));
        }

        const responses = await Promise.allSettled(promises);
        let pageError = '';

        // Process responses safely
        if (responses[0].status === 'fulfilled') {
          setBreakdowns(responses[0].value.data);
        } else {
          console.error("Error fetching breakdowns:", responses[0].reason);
          pageError += ' Failed to load breakdowns.';
        }
        
        if (responses[1].status === 'fulfilled') {
          setMachines(responses[1].value.data);
        } else {
          console.error("Error fetching machines:", responses[1].reason);
           pageError += ' Failed to load machines list.';
        }
        
        if (canViewAnalytics) {
            if (responses[2]?.status === 'fulfilled') {
                setKpis(responses[2].value.data);
            } else {
                 console.error("Error fetching KPIs:", responses[2]?.reason);
                 pageError += ' Failed to load KPIs.';
            }
            if (responses[3]?.status === 'fulfilled') {
                setChartData(responses[3].value.data);
            } else {
                 console.error("Error fetching chart data:", responses[3]?.reason);
                 // Don't necessarily set an error, chart might just be empty
                 setChartData(null); // Ensure chart isn't shown with old data
            }
        }
        
        if(pageError) setError(pageError.trim());

      } catch (err) { // Catch errors not related to specific API calls (unlikely)
        setError('An unexpected error occurred while loading dashboard data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]); // Re-fetch data if the user changes

  // Handler for updating breakdown status
  const handleStatusUpdate = async (breakdownId, newStatus) => {
    // Only Managers and Supervisors can update status
    if (!user || !['Maintenance Manager', 'Supervisor'].includes(user.role)) return;
    
    try {
      setError(''); // Clear previous errors
      await api.patch(`/breakdowns/${breakdownId}/status`, { status: newStatus });
      setBreakdowns(currentBreakdowns =>
        currentBreakdowns.map(b =>
          b.id === breakdownId ? { ...b, status: newStatus } : b
        )
      );
    } catch (err) {
      setError('Failed to update status. Please try again.');
      console.error(err);
    }
  };

  // --- Handlers for Report Breakdown Dialog ---
  const handleOpenBreakdownDialog = () => {
    setNewBreakdownData({ machineId: '', description: '' }); // Reset form
    setDialogError(''); // Clear dialog errors
    setBreakdownOpen(true);
  };
  const handleCloseBreakdownDialog = () => setBreakdownOpen(false);
  const handleBreakdownInputChange = (e) => setNewBreakdownData({ ...newBreakdownData, [e.target.name]: e.target.value });

  const handleReportBreakdown = async () => {
    setDialogError(''); // Clear previous dialog errors
    if (!newBreakdownData.machineId || !newBreakdownData.description) {
      setDialogError("Please select a machine and provide a description.");
      return;
    }
    try {
      const response = await api.post('/breakdowns', newBreakdownData);
      // Add new breakdown to the top of the list for immediate UI update
      // Make sure the response structure matches what the list expects
      const newBreakdown = {
          ...response.data.breakdown, // Use data from API response
          machine_name: machines.find(m => m.id === response.data.breakdown.machine_id)?.name || 'Unknown', // Add machine name locally
          machine_location: machines.find(m => m.id === response.data.breakdown.machine_id)?.location || '' // Add location locally
      }
      setBreakdowns(currentBreakdowns => [newBreakdown, ...currentBreakdowns]);
      handleCloseBreakdownDialog();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Failed to report breakdown.');
      console.error(err);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1">Factory Overview</Typography>
        <Box>
            {/* Report Breakdown Button - visible to all logged-in users */}
            {user && (
            <Button variant="contained" color="error" onClick={handleOpenBreakdownDialog} sx={{ mr: 2 }}>
                Report Breakdown
            </Button>
            )}
            <Button variant="outlined" onClick={logout}>Logout</Button>
        </Box>
      </Box>

      {/* --- Report Breakdown Dialog --- */}
      <Dialog open={breakdownOpen} onClose={handleCloseBreakdownDialog} fullWidth maxWidth="sm">
        <DialogTitle>Report New Breakdown</DialogTitle>
        <DialogContent>
           {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <FormControl fullWidth margin="dense" required>
            <InputLabel id="machine-select-label-breakdown">Machine</InputLabel>
            <Select
              labelId="machine-select-label-breakdown"
              name="machineId"
              value={newBreakdownData.machineId}
              label="Machine"
              onChange={handleBreakdownInputChange}
            >
              <MenuItem value=""><em>Select Machine...</em></MenuItem>
              {machines.map(machine => (
                <MenuItem key={machine.id} value={machine.id}>{machine.name} ({machine.location || 'No location'})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            name="description"
            label="Description of Issue"
            type="text"
            fullWidth
            multiline
            rows={4}
            variant="outlined"
            value={newBreakdownData.description}
            onChange={handleBreakdownInputChange}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseBreakdownDialog}>Cancel</Button>
          <Button onClick={handleReportBreakdown} variant="contained" color="error">Submit Report</Button>
        </DialogActions>
      </Dialog>

      {/* --- Rest of the Dashboard --- */}
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}><CircularProgress /></Box>}
      {/* Display general page errors */}
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Only show KPIs/Chart if user has permission AND data loaded */}
      {!loading && !error && user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
          <>
            {kpis && (
                <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6} md={3}><KpiCard title="Active Breakdowns" value={kpis.activeBreakdowns} /></Grid>
                <Grid item xs={12} sm={6} md={3}><KpiCard title="Machines Needing Attention" value={kpis.machinesNeedingAttention} /></Grid>
                </Grid>
            )}
            {chartData && chartData.length > 0 && (
                <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12}>
                    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
                    <LineChart chartData={chartData} />
                    </Paper>
                </Grid>
                </Grid>
            )}
          </>
      )}


      {!loading && (
        <Box>
          <Typography variant="h5" component="h2" gutterBottom sx={{mt: 4}}>Breakdown List</Typography>
          {breakdowns.length > 0 ? (
            breakdowns.map((breakdown) => (
              <Card key={breakdown.id} sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="h6">{breakdown.machine_name || `Machine ID ${breakdown.machine_id}`}</Typography>
                  <Typography color="text.secondary">{breakdown.machine_location || 'Location N/A'}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>{breakdown.description}</Typography>
                  <Typography variant="body2" sx={{ mt: 2 }}>Status: <strong>{breakdown.status}</strong> | Reported: {new Date(breakdown.reported_at).toLocaleString()}</Typography>
                </CardContent>
                <CardActions>
                  {/* Action buttons only for Manager/Supervisor */}
                  {user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
                    <>
                      {breakdown.status === 'Reported' && ( <Button size="small" onClick={() => handleStatusUpdate(breakdown.id, 'Acknowledged')}> Acknowledge </Button> )}
                      {breakdown.status === 'Acknowledged' && ( <Button size="small" onClick={() => handleStatusUpdate(breakdown.id, 'In Progress')}> Start Work </Button> )}
                      {breakdown.status === 'In Progress' && ( <Button size="small" onClick={() => handleStatusUpdate(breakdown.id, 'Resolved')}> Mark as Resolved </Button> )}
                    </>
                  )}
                </CardActions>
              </Card>
            ))
          ) : (
            !error && <Typography>No active breakdowns found.</Typography> // Only show if no error loading breakdowns
          )}
        </Box>
      )}
    </Container>
  );
}

export default Dashboard;