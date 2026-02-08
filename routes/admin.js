// routes/admin.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin'); // The middleware we created earlier
const { addLog, getLogs } = require('../utils/logger');

// 1. GET LOGS (For Admin Dashboard Live Feed)
router.get('/logs' , [auth, admin], (req, res) => {
    res.json(getLogs());
});

// 2. RECEIVE LOGS (For Worker or other microservices)
router.post('/log', (req, res) => {
    const { type, message } = req.body;
    addLog(type || 'INFO', message);
    res.sendStatus(200);
});

// 3. GET RISK USERS (For Watchlist)
router.get('/risky', [auth, admin], async (req, res) => {
    try {
        // Find users with Score < 90, sorted by lowest score first
        const users = await User.find({ trustScore: { $lt: 90 } })
            .sort({ trustScore: 1 })
            .select('-password'); // Don't send passwords
        res.json(users);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/admin/users
// @desc    Get all users (Admin Only)
router.get('/users', [auth, admin], async (req, res) => {
    try {
        // Fetch all users but hide their passwords
        const users = await User.find().select('-password').sort({ date: -1 });
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/admin/ban/:id
// @desc    Ban or Unban a user
router.post('/ban/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // --- 1. UNBANNING LOGIC (If they are already banned) ---
        if (user.isBanned) {
            // OPTIONAL: Prevent unban if score is CRITICAL (< 20)
            if (user.trustScore < 20) {
                return res.status(400).json({
                    msg: "❌ Cannot Unfreeze: User Trust Score is Critical (< 20). System requires score recovery first."
                });
            }

            user.isBanned = false;
            user.banExpires = null;
            user.banReason = null; // Clear reason
            await user.save();

            addLog('ADMIN', `ADMIN UNBANNED User ${user.username}. Score: ${user.trustScore}`);
            return res.json({ msg: "User Unfrozen", user });
        }

        // --- 2. BANNING LOGIC (If they are active) ---

        // RESTRICTION: Cannot ban "Good Citizens" (Score > 80)
        // This prevents admin abuse or accidental clicks.
        if (user.trustScore > 80) {
            return res.status(400).json({
                msg: "❌ Action Denied: User has High Trust Score (> 80). No suspicious activity detected."
            });
        }

        // Apply Ban
        user.isBanned = true;
        user.banExpires = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        // We auto-generate the reason based on their stats so the user knows WHY.
        let reason = "Violation of Terms.";
        if (user.rapidUploadSpamCount > 5) reason = "Excessive Spamming / Rapid Uploads.";
        if (user.trustScore < 50) reason = "Critical Trust Score Drop due to suspicious patterns.";

        user.banReason = reason;

        await user.save();
        addLog('BAN', `ADMIN BANNED User ${user.username}. Reason: ${reason}`);
        res.json({ msg: "User Frozen", user });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 3. GET SPECIFIC USER LOGS
router.get('/logs/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Filter the main memory logs for this specific user
        // (We search for their username or ID in the log messages)
        const allLogs = getLogs();
        const userLogs = allLogs.filter(log =>
            log.message.includes(user.username) ||
            (log.details && log.details.includes && log.details.includes(user.username))
        );

        res.json(userLogs);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;