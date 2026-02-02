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
router.get('/risk-users', [auth], async (req, res) => {
    try {
        const users = await User.find({ trustScore: { $lt: 60 } });
        res.json(users);
    } catch (err) { res.status(500).json([]); }
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
router.put('/ban/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Toggle Ban Status
        if (user.isBanned) {
            user.isBanned = false;
            user.banExpires = null;
            user.trustScore = 50; // Reset score to probation
        } else {
            user.isBanned = true;
            user.banExpires = new Date(Date.now() + 365*24*60*60*1000); // 1 Year Ban
            user.trustScore = 0;
        }

        await user.save();
        res.json({ msg: `User ${user.isBanned ? 'Banned' : 'Unbanned'}`, user });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

module.exports = router;