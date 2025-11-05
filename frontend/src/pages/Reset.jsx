// src/pages/Reset.jsx

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import { Container, Paper, Typography, TextField, Button, Box, Alert } from '@mui/material';

// --- Password Validation Helpers (copied from Register.jsx) ---
const validatePassword = (password) => {
  const minLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return {
    minLength,
    hasNumber,
    hasSpecial,
    isValid: minLength && hasNumber && hasSpecial,
  };
};

const PasswordValidationRules = ({ validation }) => (
  <Box sx={{ mt: 1, width: '100%' }}>
    <Typography variant="body2" sx={{ color: validation.minLength ? 'green' : 'red' }}>
      {validation.minLength ? '✔' : '✖'} At least 8 characters
    </Typography>
    <Typography variant="body2" sx={{ color: validation.hasNumber ? 'green' : 'red' }}>
      {validation.hasNumber ? '✔' : '✖'} At least one number
    </Typography>
    <Typography variant="body2" sx={{ color: validation.hasSpecial ? 'green' : 'red' }}>
      {validation.hasSpecial ? '✔' : '✖'} At least one special character
    </Typography>
  </Box>
);
// --- End Validation Helpers ---

function ResetPassword() {
  const { token } = useParams(); // Gets the token from the URL
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [validation, setValidation] = useState(validatePassword(''));
  const [passwordsMatch, setPasswordsMatch] = useState(true);
  const [isFormValid, setIsFormValid] = useState(false);
  
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Validate form on any change
  useEffect(() => {
    const isPasswordValid = validation.isValid;
    const doPasswordsMatch = password === confirmPassword;
    setPasswordsMatch(doPasswordsMatch);
    setIsFormValid(isPasswordValid && doPasswordsMatch);
  }, [password, confirmPassword, validation]);

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    setValidation(validatePassword(e.target.value));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isFormValid) return;

    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      const response = await api.post('/reset-password', {
        token: token,
        newPassword: password,
      });
      
      setSuccessMessage(response.data.message + " Redirecting to login...");
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login', { state: { message: 'Password reset successful! Please log in.' } });
      }, 3000);

    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="xs" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Typography component="h1" variant="h5">
          Set New Password
        </Typography>

        {error && <Alert severity="error" sx={{ mt: 2, width: '100%' }}>{error}</Alert>}
        {successMessage && <Alert severity="success" sx={{ mt: 2, width: '100%' }}>{successMessage}</Alert>}
        
        {!successMessage && (
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label="New Password"
              type="password"
              id="password"
              value={password}
              onChange={handlePasswordChange}
              disabled={loading}
            />
            
            <PasswordValidationRules validation={validation} />

            <TextField
              margin="normal"
              required
              fullWidth
              name="confirmPassword"
              label="Confirm New Password"
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              error={!passwordsMatch && confirmPassword.length > 0}
              helperText={!passwordsMatch && confirmPassword.length > 0 ? "Passwords do not match" : ""}
            />
            
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={!isFormValid || loading}
            >
              {loading ? 'Saving...' : 'Set New Password'}
            </Button>
          </Box>
        )}
        
        {successMessage && (
            <Box textAlign="center" sx={{ mt: 2 }}>
                <Link to="/login" variant="body2">
                    {"Click here to login immediately"}
                </Link>
            </Box>
        )}
      </Paper>
    </Container>
  );
}

export default ResetPassword;