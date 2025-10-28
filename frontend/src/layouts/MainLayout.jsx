// src/layouts/MainLayout.jsx
import React, { useState } from 'react'; // Import useState
import { Box, Drawer, List, ListItem, ListItemButton, ListItemText, Toolbar, Typography, AppBar, IconButton } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu'; // Import the Menu icon
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const drawerWidth = 240;

function MainLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  // --- NEW: State for mobile drawer ---
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };
  // ------------------------------------

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // This is your existing sidebar content, no changes needed here
  const drawer = (
    <div>
      <Toolbar />
      <List>
        <ListItem disablePadding>
          <ListItemButton component={Link} to="/dashboard">
            <ListItemText primary="Overview" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton component={Link} to="/machines">
            <ListItemText primary="Equipment" />
          </ListItemButton>
        </ListItem>
      {user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
        <ListItem disablePadding>
          <ListItemButton component={Link} to="/job-orders">
           <ListItemText primary="Job Orders" />
         </ListItemButton>
        </ListItem>
      )}
      {user && ['Maintenance Manager', 'Supervisor', 'Maintenance Technician'].includes(user.role) && (
        <ListItem disablePadding>
          <ListItemButton component={Link} to="/inspections">
           <ListItemText primary="Machine Inspections" />
         </ListItemButton>
       </ListItem>
      )}
        <ListItem disablePadding>
          <ListItemButton component={Link} to="/preventive-maintenance">
            <ListItemText primary="Preventive Maintenance" />
          </ListItemButton>
        </ListItem>
      {user && ['Maintenance Manager', 'Supervisor'].includes(user.role) && (
      <ListItem disablePadding>
        <ListItemButton component={Link} to="/utilities">
          <ListItemText primary="Utility Tracking" />
        </ListItemButton>
      </ListItem>
      )}
        <ListItem disablePadding>
          <ListItemButton component={Link} to="/user-management">
            <ListItemText primary="User Management" />
          </ListItemButton>
        </ListItem>
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar 
        position="fixed" 
        sx={{ 
          zIndex: (theme) => theme.zIndex.drawer + 1 
        }}
      >
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          
          {/* --- NEW: Mobile Menu Button --- */}
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { md: 'none' } }} // Only display on screens SMALLER than 'md' (medium)
          >
            <MenuIcon />
          </IconButton>
          {/* ------------------------------- */}

          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}> {/* Added flexGrow to help spacing */}
            {user ? user.company_name : 'PlantMaint Pro'}
          </Typography>
          <button onClick={handleLogout} style={{color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem'}}>Logout</button>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
      >
        {/* --- NEW: Temporary Drawer for Mobile --- */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', md: 'none' }, // Show on 'xs' (extra small), hide on 'md' (medium) and up
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        
        {/* --- MODIFIED: Permanent Drawer for Desktop --- */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' }, // Hide on 'xs', show on 'md' and up
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      
      {/* --- MODIFIED: Main Content Area --- */}
      <Box 
        component="main" 
        sx={{ 
          flexGrow: 1, 
          p: 3, // Add padding
          width: { md: `calc(100% - ${drawerWidth}px)` }, // Full width MINUS drawer on medium screens
          mt: '64px' // Add top margin to account for the fixed AppBar
        }}
      >
        {/* <Toolbar />  This is no longer needed here, we added 'mt: 64px' above */}
        {children}
      </Box>
    </Box>
  );
}

export default MainLayout;