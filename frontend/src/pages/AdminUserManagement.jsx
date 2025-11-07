// frontend/src/pages/AdminUserManagement.jsx
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
  Alert,
  Box
} from '@mui/material';

function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // This function fetches all users from our new admin endpoint
    const fetchAllUsers = async () => {
      try {
        setLoading(true);
        setError(null);
        // This is the new API route we created in Part A
        // NOTE: We use .post() because the route is app.post(), not app.get()
        // If you change it to app.get() in index.js, change it here too.
        const { data } = await api.get('/admin/users'); 
        setUsers(data);
      } catch (err)
         {
        console.error('Failed to fetch users:', err);
        setError(err.response?.data?.message || 'Failed to load user data.');
      } finally {
        setLoading(false);
      }
    };

    fetchAllUsers();
  }, []); // The empty array [] means this runs once on load

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" gutterBottom sx={{ mt: 3, mb: 3 }}>
        Admin - All Users
      </Typography>

      {loading && <CircularProgress />}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && !error && (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }} aria-label="all users table">
            <TableHead>
              <TableRow>
                <TableCell>User ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Phone Number</TableCell>
                <TableCell>Company</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow
                  key={user.id}
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell>{user.id}</TableCell>
                  <TableCell component="th" scope="row">
                    {user.name}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.phone_number || 'N/A'}</TableCell>
                  <TableCell>
                    {/* Admin's company is NULL, so we show 'N/A' */}
                    {user.company_name || 'N/A'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}

export default AdminUserManagement;