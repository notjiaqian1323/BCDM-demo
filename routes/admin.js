// routes/admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin'); // The middleware we created earlier
const { addLog, getLogs } = require('../utils/logger');
const Log = require('../models/Log');

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Check if the user exists
        let user = await User.findOne({ email });

        if (!user) {
            // 📝 LOG: Failed Admin Login (User Not Found)
            addLog('SECURITY', `Failed Admin Login: ${email} (User not found)`);
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        // --- 🛡️ THE BOUNCER: ADMIN ROLE CHECK ---
        // If they exist but aren't an admin, kick them out immediately
        if (user.role !== 'admin') {
            // 📝 LOG: Unauthorized Attempt! A normal user found the admin portal.
            addLog('SECURITY', `🚨 UNAUTHORIZED ADMIN ATTEMPT: Standard user ${user.username} tried to access the Command Center.`);
            return res.status(403).json({ msg: 'Access Denied: Admin privileges required.' });
        }

        // 2. Verify Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            // 📝 LOG: Failed Admin Login (Wrong Password)
            addLog('SECURITY', `Failed Admin Login: ${user.username} (Wrong Password)`);
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        // 3. Generate Token Payload
        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        // 📝 LOG: Admin Login Success
        addLog('AUTH', `🛡️ Admin Login Success: ${user.username}`);
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🎩 ADMIN SECURE LOGIN: '${user.email}'`);

        // 4. Sign and send the token back with the user data
        jwt.sign(payload, process.env.JWT_SECRET || 'mySuperSecretToken123', { expiresIn: 36000 }, (err, token) => {
            if (err) throw err;
            res.json({
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role
                }
            });
        });

    } catch (err) {
        addLog('ERROR', `Admin Login Crashed for ${email}: ${err.message}`);
        console.error(err.message);
        res.status(500).json({ msg: 'Server error', details: err.message });
    }
});

// 1. GET LOGS (For Admin Dashboard Live Feed)
router.get('/logs' , [auth, admin], async (req, res) => {
    const logs = await getLogs(50);
    res.json(logs);
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
        const users = await User.find(
            {},
            '_id username email trustScore isBanned'
        ).sort({ trustScore: 1}); // Sort by lowest score first so risky users are at the top
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

        let allLogs = getLogs();

        // 🛡️ DEFENSE 1: If getLogs() is async, wait for it to resolve
        if (allLogs instanceof Promise) {
            allLogs = await allLogs;
        }

        // 🛡️ DEFENSE 2: If it returned an object { logs: [...] }, extract the array
        if (!Array.isArray(allLogs)) {
            // Fallback to empty array if all parsing fails
            allLogs = allLogs.logs || allLogs.data || [];
        }

        // Now we can safely filter!
        // We also convert things to lowercase so "John" matches "john"
        const usernameLower = user.username.toLowerCase();

        const userLogs = allLogs.filter(log => {
            if (!log) return false; // Skip null entries

            const msg = log.message ? log.message.toLowerCase() : '';
            const det = log.details ? log.details.toLowerCase() : '';

            return msg.includes(usernameLower) || det.includes(usernameLower);
        });

        res.json(userLogs);
    } catch (err) {
        console.error("💥 [ADMIN API] Error fetching user logs:", err);
        res.status(500).send('Server Error');
    }
});

// GET /api/admin/stats
// Returns the HUD counts
router.get('/stats', [auth, admin], async (req, res) => {
    try {
        // 1. Count Total Users
        const totalUsers = await User.countDocuments({});

        // 2. Count At-Risk Users (Trust Score < 50)
        const atRiskUsers = await User.countDocuments({ trustScore: { $lt: 50 } });

        // 3. Return Data
        res.json({
            status: 'OPERATIONAL', // You can make this dynamic later based on DB connection
            total: totalUsers,
            risk: atRiskUsers
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Make sure you have imported the Log model!
// const Log = require('../models/Log');

// GET /api/admin/analytics/traffic
router.get('/analytics/traffic', auth, async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // MongoDB Aggregation Pipeline
        const trafficData = await Log.aggregate([
            { $match: { timestamp: { $gte: twentyFourHoursAgo } } },
            {
                $group: {
                    // Group by Year, Month, Day, and Hour to prevent timezone overlap bugs
                    _id: {
                        year: { $year: "$timestamp" },
                        month: { $month: "$timestamp" },
                        day: { $dayOfMonth: "$timestamp" },
                        hour: { $hour: "$timestamp" }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } }
        ]);

        // Format for Chart.js (Arrays of labels and data points)
        const labels = [];
        const dataPoints = [];

        trafficData.forEach(bucket => {
            // Format hour to look like "14:00"
            const hourStr = bucket._id.hour.toString().padStart(2, '0') + ':00';
            labels.push(hourStr);
            dataPoints.push(bucket.count);
        });

        res.json({ labels, dataPoints });

    } catch (err) {
        console.error("Traffic Analytics Error:", err);
        res.status(500).json({ labels: [], dataPoints: [] });
    }
});

module.exports = router;