// src/components/KpiCard.jsx
import React from 'react';
import { Paper, Typography, Box } from '@mui/material';

function KpiCard({ title, value }) {
  return (
    <Paper 
      elevation={3}
      sx={{ 
        p: 2, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: 140 
      }}
    >
      <Typography color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Typography component="p" variant="h4">
        {value}
      </Typography>
    </Paper>
  );
}

export default KpiCard;