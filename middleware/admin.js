const User = require('../models/User');

module.exports = function(req, res, next) {
    // 1. Check if Auth ran
    if (!req.user) {
        return res.status(500).json({ msg: "Server Error: Admin middleware used without Auth middleware." });
    }

    // 2. Check Role (No need to query DB again, req.user is already the full user object!)
    if (req.user.role !== 'admin') {
        return res.status(403).json({ msg: "⛔ Access Denied: Admins Only." });
    }

    next();
};