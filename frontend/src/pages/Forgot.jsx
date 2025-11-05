// src/pages/Forgot.jsx

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { Container, Paper, Typography, TextField, Button, Box, Alert } from '@mui/material';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      // This endpoint always returns a 200 OK for security
      // to prevent email enumeration attacks.
      const response = await api.post('/forgot-password', { email });
      setSuccessMessage(response.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="xs" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Typography component="h1" variant="h5">
          Reset Password
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, textAlign: 'center' }}>
          Enter your email and we'll send you a link to reset your password.
        </Typography>

        {error && <Alert severity="error" sx={{ mt: 2, width: '100%' }}>{error}</Alert>}
        {successMessage && <Alert severity="success" sx={{ mt: 2, width: '100%' }}>{successMessage}</Alert>}
        
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
          <TextField
            margin="normal"
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || !!successMessage} // Disable if loading or success
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 3, mb: 2 }}
            disabled={loading || !!successMessage} // Disable if loading or success
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
          <Box textAlign="center">
            <Link to="/login" variant="body2">
              {"Back to Login"}
            </Link>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}

export default ForgotPassword;