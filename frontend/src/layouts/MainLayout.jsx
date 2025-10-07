// src/layouts/MainLayout.jsx
import React from 'react';
import { Box, Drawer, List, ListItem, ListItemButton, ListItemText, Toolbar, Typography, AppBar } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const drawerWidth = 240;

function MainLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const drawer = (
    <div>
      <Toolbar />
      <List>
        {/* UPDATED: Added 'Operator' to this list */}
        {user && ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'].includes(user.role) && (
          <ListItem disablePadding>
            <ListItemButton component={Link} to="/dashboard">
              <ListItemText primary="Overview" />
            </ListItemButton>
          </ListItem>
        )}
        
        {/* Show Preventive Maintenance to Managers and Supervisors */}
        {user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
          <ListItem disablePadding>
            <ListItemButton component={Link} to="/preventive-maintenance">
              <ListItemText primary="Preventive Maintenance" />
            </ListItemButton>
          </ListItem>
        )}
        
        {/* Show User Management to Managers ONLY */}
        {user && user.role === 'Maintenance Manager' && (
          <ListItem disablePadding>
            <ListItemButton component={Link} to="/user-management">
              <ListItemText primary="User Management" />
            </ListItemButton>
          </ListItem>
        )}
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="h6" noWrap component="div">
            PlantMaint Pro
          </Typography>
          <button onClick={handleLogout} style={{color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem'}}>Logout</button>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        {drawer}
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}

export default MainLayout;