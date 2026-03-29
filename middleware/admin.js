// middleware/admin.js - ESM Version
import User from '../models/User.js'; // 🚨 Extension required

export default function(req, res, next) {
    // 1. Check if Auth ran (req.user must be populated by auth middleware)
    if (!req.user) {
        return res.status(500).json({
            msg: "Server Error: Admin middleware used without Auth middleware."
        });
    }

    // 2. Check Role (No need to query DB again, req.user is already the full user object!)
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            msg: "⛔ Access Denied: Admins Only."
        });
    }

    next();
}