import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import KpiCard from '../components/KpiCard';
import LineChart from '../components/LineChart';
import { 
  Container, Typography, Button, Box, Card, CardContent, CardActions,
  CircularProgress, Alert, Grid, Paper
} from '@mui/material';

function Dashboard() {
  const { user, logout } = useAuth();
  const [breakdowns, setBreakdowns] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const promises = [
          api.get('/dashboard/kpis'),
          api.get('/breakdowns')
        ];
        
        // Only fetch chart data if a utility exists (utilityId=1 is a placeholder)
        // In a real app, you'd have a selector
        promises.push(api.get('/charts/utility-consumption?utilityId=1&days=30'));
        
        const [kpisRes, breakdownsRes, chartRes] = await Promise.all(promises);
        
        setKpis(kpisRes.data);
        setBreakdowns(breakdownsRes.data);
        if (chartRes && chartRes.data) {
          setChartData(chartRes.data);
        }

      } catch (err) {
        setError('Failed to fetch dashboard data. Some parts may be missing.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleStatusUpdate = async (breakdownId, newStatus) => {
    try {
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

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1">Factory Overview</Typography>
        <Button variant="contained" onClick={logout}>Logout</Button>
      </Box>
      
      {loading && <CircularProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      
      {!loading && kpis && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}><KpiCard title="Active Breakdowns" value={kpis.activeBreakdowns} /></Grid>
          <Grid item xs={12} sm={6} md={3}><KpiCard title="Machines Needing Attention" value={kpis.machinesNeedingAttention} /></Grid>
        </Grid>
      )}

      {!loading && chartData && chartData.length > 0 && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12}>
            <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
              <LineChart chartData={chartData} />
            </Paper>
          </Grid>
        </Grid>
      )}

      {!loading && !error && (
        <Box>
          <Typography variant="h5" component="h2" gutterBottom>Breakdown List</Typography>
          {breakdowns.length > 0 ? (
            breakdowns.map((breakdown) => (
              <Card key={breakdown.id} sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="h6">{breakdown.machine_name}</Typography>
                  <Typography color="text.secondary">{breakdown.machine_location}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>{breakdown.description}</Typography>
                  <Typography variant="body2" sx={{ mt: 2 }}>Status: <strong>{breakdown.status}</strong> | Reported: {new Date(breakdown.reported_at).toLocaleString()}</Typography>
                </CardContent>
                <CardActions>
                  {/* Corrected conditional logic for action buttons */}
                  {user && user.role === 'Maintenance Manager' && (
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
            <Typography>No active breakdowns found.</Typography>
          )}
        </Box>
      )}
    </Container>
  );
}

export default Dashboard;