// frontend/src/pages/AdminCompanyManagement.jsx
// --- (NEW FILE) ---

import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert
} from '@mui/material';

function AdminCompanyManagement() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // This function fetches the data from our new admin endpoint
    const fetchCompanies = async () => {
      try {
        setLoading(true);
        setError(null);
        // This is the new API route we created in Step 3
        const { data } = await api.get('/admin/companies');
        setCompanies(data);
      } catch (err) {
        console.error('Failed to fetch companies:', err);
        setError(err.response?.data?.message || 'Failed to load company data.');
      } finally {
        setLoading(false);
      }
    };

    fetchCompanies();
  }, []); // The empty array [] means this runs once on load

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" gutterBottom sx={{ mt: 3, mb: 3 }}>
        Admin - Company Management
      </Typography>

      {loading && <CircularProgress />}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && !error && (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }} aria-label="company table">
            <TableHead>
              <TableRow>
                <TableCell>Company Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Company ID</TableCell>
                <TableCell>Created At</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {companies.map((company) => (
                <TableRow
                  key={company.id}
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell component="th" scope="row">
                    {company.name}
                  </TableCell>
                  <TableCell>{company.status}</TableCell>
                  <TableCell>{company.id}</TableCell>
                  <TableCell>{new Date(company.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}

export default AdminCompanyManagement;