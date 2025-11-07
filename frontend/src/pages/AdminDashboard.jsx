// frontend/src/pages/AdminDashboard.jsx
// --- (NEW FILE) ---

import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  Container,
  Typography,
  Grid,
  CircularProgress,
  Alert
} from '@mui/material';
import KpiCard from '../components/KpiCard'; // We'll use your existing component
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';

function AdminDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        setError(null);
        // This is the new API route we created in Part A
        const { data } = await api.get('/admin/metrics');
        setMetrics(data);
      } catch (err) {
        console.error('Failed to fetch metrics:', err);
        setError(err.response?.data?.message || 'Failed to load metrics.');
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []); // The empty array [] means this runs once on load

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" gutterBottom sx={{ mt: 3, mb: 3 }}>
        Admin Dashboard
      </Typography>

      {loading && <CircularProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && metrics && (
        <Grid container spacing={3}>
          {/* Card for Active Companies */}
          <Grid item xs={12} md={6} lg={4}>
            <KpiCard
              title="Active Companies"
              value={metrics.activeCompanies}
              icon={<BusinessIcon sx={{ fontSize: 60 }} color="primary" />}
            />
          </Grid>

          {/* Card for Total Users */}
          <Grid item xs={12} md={6} lg={4}>
            <KpiCard
              title="Total Users"
              value={metrics.totalUsers}
              icon={<PeopleIcon sx={{ fontSize: 60 }} color="secondary" />}
            />
          </Grid>

          {/* We can add more KpiCards here as we add metrics */}

        </Grid>
      )}
    </Container>
  );
}

export default AdminDashboard;