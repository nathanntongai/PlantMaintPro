// frontend/src/pages/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import KpiCard from '../components/KpiCard';
import LineChart from '../components/LineChart';
import { saveAs } from 'file-saver'; // Import file-saver
import { 
  Container, Typography, Button, Box, Card, CardContent, CardActions,
  CircularProgress, Alert, Grid, Paper, // Grid is imported
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

  // This useEffect is 100% from YOUR original, working file.
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');
        
        const [kpiRes, breakdownRes, machineRes] = await Promise.all([
          api.get('/api/kpis'),
          api.get('/api/breakdowns/active'),
          api.get('/api/machines')
        ]);

        setKpis(kpiRes.data);
        setBreakdowns(breakdownRes.data);
        setMachines(machineRes.data); // Save machines for the dialog

        // Process data for the line chart
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

      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        setError('Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // All functions below are 100% from YOUR original, working file.

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
      const response = await api.post('/api/breakdowns', {
        machine_id: newBreakdownData.machineId,
        description: newBreakdownData.description,
      });
      setBreakdowns([response.data, ...breakdowns]);
      handleCloseBreakdownDialog();
    } catch (err) {
      console.error("Error reporting breakdown:", err);
      setDialogError('Failed to report breakdown.');
    }
  };

  const handleStatusUpdate = async (id, status) => {
    try {
      const response = await api.patch(`/api/breakdowns/${id}/status`, { status });
      setBreakdowns(breakdowns.map(b => b.id === id ? response.data : b));
    } catch (err) {
      console.error("Error updating status:", err);
      setError('Failed to update status.');
    }
  };

  const handleDownloadReport = async () => {
    try {
      const response = await api.get('/api/breakdowns/report/excel', {
        responseType: 'blob', // Important: Tell axios to expect a file
      });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, 'breakdown_report.xlsx');
    } catch (err) {
      console.error('Error downloading report:', err);
      setError('Failed to download report.');
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

      {/* ---
        --- THE ONLY CHANGE IS HERE ---
        --- We are using a <Grid> for responsiveness ---
      --- */}
      {kpis && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Total Breakdowns" value={kpis.total_breakdowns} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Machine Availability" value={`${kpis.machine_availability_percentage}%`} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Pending" value={kpis.pending_breakdowns} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <KpiCard title="Avg. Repair Time" value={kpis.average_repair_time_formatted} />
          </Grid>
        </Grid>
      )}
      {/* --- END OF THE CHANGE --- */}


      {/* --- Charts Section (from your original file) --- */}
      {chartData && (
        <Paper sx={{ p: 2, mb: 4 }}>
          <Typography variant="h6" gutterBottom>Breakdown Trends</Typography>
          <Box sx={{ height: '300px' }}>
            <LineChart data={chartData} />
          </Box>
        </Paper>
      )}

      {/* --- Active Breakdowns List (from your original file) --- */}
      {!loading && (
        <Box>
          <Typography variant="h5" component="h2" gutterBottom>Active Breakdowns</Typography>
          {breakdowns.length > 0 ? (
            breakdowns.map((breakdown) => (
              <Card key={breakdown.id} sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="h6">{breakdown.machine_name}</Typography>
                  <Typography color="text.secondary">{breakdown.machine_location || 'Location N/A'}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>{breakdown.description}</Typography>
                  <Typography variant="body2" sx={{ mt: 2 }}>Status: <strong>{breakdown.status}</strong> | Reported: {new Date(breakdown.reported_at).toLocaleString()}</Typography>
                </CardContent>
                <CardActions>
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
            !error && <Typography>No active breakdowns found.</Typography>
          )}
        </Box>
      )}
      
      {/* --- Report Breakdown Dialog (from your original file) --- */}
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
            >
              <MenuItem value=""><em>Select a machine</em></MenuItem>
              {machines.map((machine) => (
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
            onChange={(e) => setNewBreakdownData({ ...newBreakdownData, description: e.targe.value })}
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseBreakdownDialog}>Cancel</Button>
          <Button onClick={handleReportSubmit} variant="contained">Submit</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default Dashboard;