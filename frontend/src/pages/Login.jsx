// frontend/src/pages/Login.jsx
// --- (This is the complete, correct file) ---

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Container, Box, Typography, TextField, Button,
  Alert, CircularProgress, Paper, Avatar
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import './Login.css';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  // --- THIS LINE FIXES THE ERROR ---
  const [loading, setLoading] = useState(false); 
  // --- END FIX ---

  const { login } = useAuth();
  const navigate = useNavigate(); // We keep this for the 'Forgot Password' link

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true); // This line will now work
    try {
      await login(email, password);
      // We no longer call navigate('/') here.
      // App.jsx will handle the redirect.
    } catch (err) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false); 
    }
  };

  return (
    <Container component="main" maxWidth="xs" className="login-container">
      <Paper elevation={6} sx={{
        marginTop: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '16px',
        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)'
      }}>
        <Avatar sx={{ m: 1, bgcolor: 'secondary.main' }}>
          <LockOutlinedIcon />
        </Avatar>
        <Typography component="h1" variant="h5">
          Sign In
        </Typography>
        <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 1 }}>
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
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label="Password"
            type="password"
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          
          {error && (
            <Alert severity="error" sx={{ width: '100%', mt: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 3, mb: 2 }}
            disabled={loading}
          >
            {loading ? <CircularProgress size={24} /> : 'Sign In'}
          </Button>
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <RouterLink to="/forgot-password" style={{ textDecoration: 'none' }}>
              <Typography variant="body2">
                Forgot password?
              </Typography>
            </RouterLink>
            <RouterLink to="/register" style={{ textDecoration: 'none' }}>
              <Typography variant="body2">
                {"Don't have an account? Sign Up"}
              </Typography>
            </RouterLink>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}

export default Login;