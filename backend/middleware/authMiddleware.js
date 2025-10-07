// backend/middleware/authMiddleware.js

const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.sendStatus(401); // Unauthorized
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Forbidden
    }
    req.user = user;
    next();
  });
};

// NEW: Middleware for checking user roles
const authorize = (allowedRoles) => {
  return (req, res, next) => {
    // We get the user object from the previous authenticateToken middleware
    const { role } = req.user;

    // Check if the user's role is in the list of allowed roles
    if (allowedRoles.includes(role)) {
      next(); // Role is allowed, proceed to the endpoint
    } else {
      // Role is not allowed, send a Forbidden error
      res.status(403).json({ message: 'Forbidden: You do not have permission to perform this action.' });
    }
  };
};


module.exports = { authenticateToken, authorize };