// routes/subscription.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth'); // <--- Import Auth Middleware
const { addLog } = require('../utils/logger');

const PLANS = {
    'Basic': 50 * 1024 * 1024,          // 50 MB
    'Premium': 50 * 1024 * 1024 * 1024, // 50 GB
    'Enterprise': 500 * 1024 * 1024 * 1024 // 500 GB
};

// @route   GET /api/subscription/status
// @desc    Get CURRENT user's storage info
router.get('/status', auth, async (req, res) => { // <--- Added 'auth' here
    try {
        // Use req.user.id (from the token) instead of a hardcoded ID
        const user = await User.findById(req.user.id);

        if (!user) return res.status(404).json({ msg: "User not found" });

        res.json({
            package: user.package,
            limit: user.storageLimit,
            used: user.storageUsed,
            percentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(4) + "%"
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// @route   POST /api/subscription/upgrade
// @desc    Upgrade CURRENT user's plan
router.post('/upgrade', auth, async (req, res) => { // <--- Added 'auth' here
    try {
        const { planName } = req.body; 
        if (!PLANS[planName]) {
            addLog('WARN', `User ${req.user.username} attempted upgrade to INVALID plan: "${planName}"`);
            return res.status(400).json({ msg: `Invalid Plan` });
        }

        const user = await User.findById(req.user.id);
        user.package = planName; 
        user.storageLimit = PLANS[planName];
        
        await user.save();

        addLog('SUCCESS', `User ${user.username} UPGRADED plan: [ ${oldPlan} ➔ ${planName} ]`);
        res.json({ msg: `🎉 Success! Upgraded to ${planName} Plan` });
    } catch (err) {
        addLog('ERROR', `Upgrade failed for ${req.user.username}: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// @route   POST /api/subscription/reset
// @desc    Reset CURRENT user to Basic
router.post('/reset', auth, async (req, res) => { // <--- Added 'auth' here
    try {
        const user = await User.findById(req.user.id);
        user.package = "Basic"; 
        user.storageLimit = PLANS['Basic'];
        
        await user.save();

        addLog('WARN', `User ${user.username} DOWNGRADED/RESET plan: [ ${oldPlan} ➔ Basic ]`);
        res.json({ msg: "🔄 Account Reset to Basic Plan" });
    } catch (err) {
        addLog('ERROR', `Plan Reset failed for ${req.user.username}: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;