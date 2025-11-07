// frontend/src/pages/AdminReports.jsx
// --- (NEW FILE) ---

import React, { useState } from 'react';
import api from '../api';
import { saveAs } from 'file-saver'; // Import the library
import {
  Container,
  Typography,
  Paper,
  Button,
  Box,
  CircularProgress,
  Alert
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

function AdminReports() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownloadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      // This is the new API route we created in Part A
      const response = await api.get('/admin/reports/summary', {
        responseType: 'blob', // IMPORTANT: Tell axios to expect a file
      });

      // Use file-saver to trigger the download
      const fileName = `PlantMaintPro_Summary_${new Date().toISOString().split('T')[0]}.xlsx`;
      saveAs(response.data, fileName);

    } catch (err) {
      console.error('Failed to download report:', err);
      setError('Failed to download report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" gutterBottom sx={{ mt: 3, mb: 3 }}>
        Admin - Reports
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          System Summary
        </Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          Download a full Excel report of all companies and all users
          currently in the system.
        </Typography>

        <Box sx={{ position: 'relative' }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<DownloadIcon />}
            disabled={loading}
            onClick={handleDownloadSummary}
          >
            Download Report
          </Button>
          {loading && (
            <CircularProgress
              size={24}
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                marginTop: '-12px',
                marginLeft: '-12px',
              }}
            />
          )}
        </Box>
      </Paper>

    </Container>
  );
}

export default AdminReports;