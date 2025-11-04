// src/pages/Register.jsx
import React, { useState, useEffect } from 'react'; // --- UPDATED ---
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';
import { Container, Paper, Typography, TextField, Button, Box, Alert } from '@mui/material';

// --- NEW: Helper function to validate password ---
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

// --- NEW: Component to show password rules ---
const PasswordValidationRules = ({ validation }) => (
  <Box sx={{ mt: 1, width: '100%' }}>
    <Typography
      variant="body2"
      sx={{ color: validation.minLength ? 'green' : 'red' }}
    >
      {validation.minLength ? '✔' : '✖'} At least 8 characters
    </Typography>
    <Typography
      variant="body2"
      sx={{ color: validation.hasNumber ? 'green' : 'red' }}
    >
      {validation.hasNumber ? '✔' : '✖'} At least one number
    </Typography>
    <Typography
      variant="body2"
      sx={{ color: validation.hasSpecial ? 'green' : 'red' }}
    >
      {validation.hasSpecial ? '✔' : '✖'} At least one special character
    </Typography>
  </Box>
);

function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    companyName: '',
    userName: '',
    email: '',
    password: '',
    phoneNumber: '', 
  });
  const [error, setError] = useState('');

  // --- NEW: State for password validation ---
  const [validation, setValidation] = useState(validatePassword(''));
  const [isPasswordTouched, setIsPasswordTouched] = useState(false);
  // --- END NEW ---

  // --- NEW: State for overall form validity ---
  const [isFormValid, setIsFormValid] = useState(false);

  // --- UPDATED: useEffect to check form validity ---
  useEffect(() => {
    const { companyName, userName, email, phoneNumber } = formData;
    const allFieldsFilled = companyName && userName && email && phoneNumber;
    setIsFormValid(allFieldsFilled && validation.isValid);
  }, [formData, validation]);
  // --- END UPDATED ---


  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData(prevState => ({ ...prevState, [name]: value }));

    // --- NEW: Validate password on change ---
    if (name === 'password') {
      setValidation(validatePassword(value));
    }
    // --- END NEW ---
  };

  // --- NEW: Handle password field focus ---
  const handlePasswordFocus = () => {
    setIsPasswordTouched(true);
  };
  // --- END NEW ---

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    // --- NEW: Final check just in case (though button should be disabled) ---
    if (!isFormValid) {
      setError('Please fill in all required fields and ensure your password meets the criteria.');
      return;
    }
    // --- END NEW ---

    try {
      await api.post('/register', formData);
      navigate('/login', { state: { message: 'Registration successful! Please log in.' } });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
      console.error(err);
    }
  };

  return (
    <Container component="main" maxWidth="xs" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Typography component="h1" variant="h5">
          Sign Up for PlantMaint Pro
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2, width: '100%' }}>{error}</Alert>}
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
          <TextField margin="normal" required fullWidth id="companyName" label="Company Name" name="companyName" autoFocus value={formData.companyName} onChange={handleInputChange} />
          <TextField margin="normal" required fullWidth id="userName" label="Your Full Name" name="userName" value={formData.userName} onChange={handleInputChange} />
          <TextField margin="normal" required fullWidth id="email" label="Email Address" name="email" autoComplete="email" value={formData.email} onChange={handleInputChange} />
          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label="Password"
            type="password"
            id="password"
            value={formData.password}
            onChange={handleInputChange}
            onFocus={handlePasswordFocus} // --- NEW ---
          />
          
          {/* --- NEW: Show validation rules --- */}
          {isPasswordTouched && <PasswordValidationRules validation={validation} />}
          {/* --- END NEW --- */}

          <TextField
            margin="normal"
            required
            fullWidth
            name="phoneNumber"
            label="WhatsApp Phone Number (e.g. 254...)" // --- UPDATED: Removed + sign ---
            type="text"
            id="phoneNumber"
            value={formData.phoneNumber}
            onChange={handleInputChange}
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 3, mb: 2 }}
            disabled={!isFormValid} // --- UPDATED ---
          >
            Register
          </Button>
          <Box textAlign="center">
            <Link to="/login" variant="body2">
              {"Already have an account? Login"}
            </Link>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}

export default Register;