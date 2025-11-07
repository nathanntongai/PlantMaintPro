// frontend/src/pages/AdminDashboard.jsx
// --- (UPDATED with Charts) ---

import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  Container,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  Paper,
  Box
} from '@mui/material';
import KpiCard from '../components/KpiCard';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';

// --- NEW: Chart.js Imports ---
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);
// --- END NEW ---

function AdminDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- NEW: State for chart data ---
  const [signupsData, setSignupsData] = useState(null);
  const [breakdownsData, setBreakdownsData] = useState(null);
  // --- END NEW ---

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch KPI Metrics
        const metricsRes = await api.get('/admin/metrics');
        setMetrics(metricsRes.data);

        // 2. Fetch Signups Chart Data
        const signupsRes = await api.get('/admin/charts/signups');
        setSignupsData(formatSignupsChart(signupsRes.data));

        // 3. Fetch Breakdowns Chart Data
        const breakdownsRes = await api.get('/admin/charts/breakdowns');
        setBreakdownsData(formatBreakdownsChart(breakdownsRes.data));

      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
        setError(err.response?.data?.message || 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  // --- NEW: Helper functions to format data for charts ---
  const formatSignupsChart = (data) => {
    const labels = data.map(d => new Date(d.week).toLocaleDateString());
    const values = data.map(d => d.signups);

    return {
      labels,
      datasets: [{
        label: 'New Users per Week',
        data: values,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
      }]
    };
  };

  const formatBreakdownsChart = (data) => {
    const labels = data.map(d => new Date(d.day).toLocaleDateString());
    const values = data.map(d => d.breakdowns);

    return {
      labels,
      datasets: [{
        label: 'Breakdowns per Day',
        data: values,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
      }]
    };
  };
  // --- END NEW ---

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
    },
  };

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" gutterBottom sx={{ mt: 3, mb: 3 }}>
        Admin Dashboard
      </Typography>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && metrics && (
        <Grid container spacing={3}>
          {/* KPI Cards */}
          <Grid item xs={12} md={6} lg={4}>
            <KpiCard
              title="Active Companies"
              value={metrics.activeCompanies}
              icon={<BusinessIcon sx={{ fontSize: 60 }} color="primary" />}
            />
          </Grid>
          <Grid item xs={12} md={6} lg={4}>
            <KpiCard
              title="Total Users"
              value={metrics.totalUsers}
              icon={<PeopleIcon sx={{ fontSize: 60 }} color="secondary" />}
            />
          </Grid>
        </Grid>
      )}

      {/* --- NEW: Charts Section --- */}
      {!loading && (
        <Grid container spacing={3} sx={{ mt: 2 }}>
          {/* Signups Chart */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                New Users (Last 3 Months)
              </Typography>
              {signupsData && <Line options={chartOptions} data={signupsData} />}
            </Paper>
          </Grid>

          {/* Breakdowns Chart */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Breakdowns Reported (Last 30 Days)
              </Typography>
              {breakdownsData && <Line options={chartOptions} data={breakdownsData} />}
            </Paper>
          </Grid>
        </Grid>
      )}
      {/* --- END NEW --- */}

    </Container>
  );
}

export default AdminDashboard;