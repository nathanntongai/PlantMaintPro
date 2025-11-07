// backend/middleware/authMiddleware.js
// --- (UPDATED with Admin permissions) ---

const jwt = require('jsonwebtoken');

// This function checks if a token exists and is valid
// (This function is UNCHANGED)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    return res.sendStatus(401); // No token
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Invalid token
    }
    req.user = user; // user = { userId, role, companyId }
    next();
  });
}

// This function checks if the user's role is allowed
// --- THIS FUNCTION IS NOW UPDATED ---
function authorize(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user.role;

    // --- NEW ADMIN RULE ---
    // If the user is an 'admin', grant access immediately
    if (userRole === 'admin') {
      return next();
    }
    // --- END NEW ADMIN RULE ---

    // If not an admin, check if their role is in the allowed list
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: 'Forbidden: You do not have permission for this action.' });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  authorize
};