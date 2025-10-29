// frontend/src/pages/Dashboard.jsx (Corrected API Paths)
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import KpiCard from '../components/KpiCard';
import LineChart from '../components/LineChart';
import { saveAs } from 'file-saver'; // Import file-saver
import {
  Container, Typography, Button, Box, Card, CardContent, CardActions,
  CircularProgress, Alert, Grid, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download'; // Import icon

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
      try {
        setLoading(true);
        setError('');

        // --- Paths Corrected to Match index.js ---
        const [kpiRes, breakdownRes, machineRes] = await Promise.all([
          api.get('/api/kpis'),             // Has /api prefix in index.js
          api.get('/api/breakdowns/active'), // Has /api prefix in index.js
          api.get('/machines')               // Does NOT have /api prefix in index.js
        ]);
        // ----------------------------------------

        setKpis(kpiRes.data);
        setBreakdowns(breakdownRes.data);
        setMachines(machineRes.data); // Save machines for the dialog

        // Process data for the line chart (Ensure breakdownRes.data exists)
        if (breakdownRes.data && breakdownRes.data.length > 0) {
            const dailyCounts = breakdownRes.data.reduce((acc, breakdown) => {
                const date = new Date(breakdown.reported_at).toLocaleDateString();
                acc[date] = (acc[date] || 0) + 1;
                return acc;
            }, {});
            setChartData({
                labels: Object.keys(dailyCounts),
                datasets: [{
                label: 'Breakdowns per Day',
                data: Object.values(dailyCounts),
                fill: false,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
                }]
            });
        } else {
             setChartData(null); // Set to null if no breakdown data
        }

      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        // Display a more informative error message
        setError(`Failed to load dashboard data. ${err.response?.data?.message || err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []); // Empty dependency array means this runs once on mount

  // --- Functions below are identical to your original working file ---

  const handleOpenBreakdownDialog = () => {
    setDialogError('');
    setNewBreakdownData({ machineId: '', description: '' });
    setBreakdownOpen(true);
  };

  const handleCloseBreakdownDialog = () => {
    setBreakdownOpen(false);
  };

  const handleReportSubmit = async () => {
    if (!newBreakdownData.machineId || !newBreakdownData.description) {
      setDialogError('Please select a machine and provide a description.');
      return;
    }
    try {
      // NOTE: Ensure '/api/breakdowns' path is correct in index.js for this POST
      const response = await api.post('/api/breakdowns', {
        machine_id: newBreakdownData.machineId,
        description: newBreakdownData.description,
      });
      // Prepend new breakdown to keep list order consistent
      setBreakdowns([response.data.breakdown, ...breakdowns]);
      handleCloseBreakdownDialog();
    } catch (err) {
      console.error("Error reporting breakdown:", err);
      setDialogError(err.response?.data?.message || 'Failed to report breakdown.');
    }
  };

  const handleStatusUpdate = async (id, status) => {
    try {
      setError(''); // Clear previous general errors
      // NOTE: Ensure '/api/breakdowns/:id/status' path is correct in index.js for this PATCH
      const response = await api.patch(`/api/breakdowns/${id}/status`, { status });
      // Update the state immutably
      setBreakdowns(breakdowns.map(b => (b.id === id ? response.data.breakdown : b)));
    } catch (err) {
      console.error("Error updating status:", err);
      setError(err.response?.data?.message || 'Failed to update status.');
    }
  };

  const handleDownloadReport = async () => {
    try {
      setError(''); // Clear previous errors
      // NOTE: Ensure '/api/breakdowns/report/excel' path is correct in index.js for this GET
      const response = await api.get('/api/breakdowns/report/excel', {
        responseType: 'blob', // Important: Tell axios to expect a file
      });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      // Use a timestamp in the filename
      const filename = `breakdown_report_${new Date().toISOString().split('T')[0]}.xlsx`;
      saveAs(blob, filename);
    } catch (err) {
      console.error('Error downloading report:', err);
      setError(err.response?.data?.message || 'Failed to download report.');
    }
  };


  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* --- Page Header --- */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          Welcome, {user ? user.name : 'User'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: { xs: 2, md: 0 } }}> {/* Wrap buttons on mobile */}
          <Button variant="contained" onClick={handleOpenBreakdownDialog}>
            Report Breakdown
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadReport}>
            Download Report
          </Button>
        </Box>
      </Box>

      {/* --- Loading and Error States --- */}
      {loading && <CircularProgress sx={{ display: 'block', margin: 'auto' }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* --- KPI Cards Section (Using Grid for responsiveness) --- */}
      {!loading && kpis && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {/* Use optional chaining ?. in case kpis is null initially */}
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Total Breakdowns" value={kpis?.total_breakdowns ?? 'N/A'} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Machine Availability" value={`${kpis?.machine_availability_percentage ?? 'N/A'}%`} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Pending" value={kpis?.pending_breakdowns ?? 'N/A'} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Avg. Repair Time" value={kpis?.average_repair_time_formatted ?? 'N/A'} />
          </Grid>
        </Grid>
      )}

      {/* --- Charts Section --- */}
      {!loading && chartData && (
        <Paper sx={{ p: 2, mb: 4 }}>
          <Typography variant="h6" gutterBottom>Breakdown Trends</Typography>
          <Box sx={{ height: '300px' }}> {/* Ensure chart has a defined height */}
            <LineChart data={chartData} />
          </Box>
        </Paper>
      )}
      {!loading && !chartData && !error && (
         <Typography sx={{mb: 4}}>No breakdown data available for chart.</Typography>
      )}

      {/* --- Report Breakdown Dialog (Modal) --- */}
      <Dialog open={breakdownOpen} onClose={handleCloseBreakdownDialog}>
        <DialogTitle>Report a New Breakdown</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <FormControl fullWidth margin="normal">
            <InputLabel id="machine-select-label">Machine</InputLabel>
            <Select
              labelId="machine-select-label"
              value={newBreakdownData.machineId}
              label="Machine"
              onChange={(e) => setNewBreakdownData({ ...newBreakdownData, machineId: e.target.value })}
              required // Make required
            >
              <MenuItem value=""><em>Select a machine</em></MenuItem>
              {/* Ensure machines array is populated before mapping */}
              {machines && machines.map((machine) => (
                <MenuItem key={machine.id} value={machine.id}>{machine.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="normal"
            required
            fullWidth
            label="Description of Problem"
            value={newBreakdownData.description}
            onChange={(e) => setNewBreakdownData({ ...newBreakdownData, description: e.target.value })}
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseBreakdownDialog}>Cancel</Button>
          <Button onClick={handleReportSubmit} variant="contained">Submit</Button>
        </DialogActions>
      </Dialog>


      {/* --- Active Breakdowns List --- */}
      {!loading && (
        <Box>
          <Typography variant="h5" component="h2" gutterBottom>Active Breakdowns</Typography>
          {breakdowns && breakdowns.length > 0 ? (
            breakdowns.map((breakdown) => (
              <Card key={breakdown.id} sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="h6">{breakdown.machine_name}</Typography>
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