const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { addLog } = require('../utils/logger'); // ✅ Import Logger

// --- 1. REGISTER ---
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        let user = await User.findOne({ email });

        if (user) {
            // 📝 LOG: Registration Failed (Duplicate)
            addLog('WARN', `Registration Failed: Email ${email} already exists.`);
            return res.status(400).json({ msg: 'User already exists' });
        }

        user = new User({ username, email, password });
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();

        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET || 'mySuperSecretToken123', { expiresIn: 36000 }, (err, token) => {
            if (err) addLog('ERROR', `Registration Crashed for ${email}: ${err.message}`);
            res.json({ token });
        });

        // 📝 LOG: Registration Success
        addLog('AUTH', `New User Registered: ${username} (${email})`);

    } catch (err) {
        // 📝 LOG: Server Error during Register
        addLog('ERROR', `Registration Crashed for ${email}: ${err.message}`);
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// --- 2. LOGIN ---
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user = await User.findOne({ email });

        if (!user) {
            // 📝 LOG: Login Failed (User Not Found)
            addLog('SECURITY', `Failed Login: ${email} (User not found)`);
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        // --- 🛡️ THE REVERSE BOUNCER: BLOCK ADMINS ---
        if (user.role === 'admin') {
            addLog('SECURITY', `Admin ${user.email} attempted to use the standard user portal.`);
            return res.status(403).json({ msg: 'Access Denied: Please use the Admin Portal to log in.' });
        }

        // --- 🛡️ BAN CHECK ---
        if (user.checkBanStatus && user.checkBanStatus()) {
            // 📝 LOG: Banned User Attempt
            addLog('SECURITY', `🚫 BANNED USER ATTEMPT: ${user.username} tried to login but is blocked.`);

            return res.status(403).json({
                msg: '⛔ Account Suspended.',
                reason: 'Trust Score hit 0',
                banExpires: user.banExpires
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            // 📝 LOG: Login Failed (Wrong Password)
            addLog('SECURITY', `Failed Login: ${user.username} (Wrong Password)`);
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        // Generate Token
        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        // 📝 LOG: Login Success
        addLog('AUTH', `User Login: ${user.username}. Role: [${user.role.toUpperCase()}]`);

        // // Terminal Log (Keep this for your debugging comfort)
        // const timestamp = new Date().toLocaleTimeString();
        // console.log(`[${timestamp}] 🔑 LOGIN SUCCESS: User '${user.email}'`);

        jwt.sign(payload, process.env.JWT_SECRET || 'mySuperSecretToken123', { expiresIn: 36000 }, (err, token) => {
            if (err) addLog('ERROR', `Registration Crashed for ${email}: ${err.message}`);
            res.json({
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    trustScore: user.trustScore,
                    isBanned: user.isBanned
                }
            });
        });

    } catch (err) {
        addLog('ERROR', `Login Crashed for ${email}: ${err.message}`);
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// --- 3. GET USER INFO ---
router.get('/user', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');

        if (user.checkBanStatus && user.checkBanStatus()) {
            // 📝 LOG: Live Session Block
            addLog('SECURITY', `🚫 Active Session Blocked: Banned user ${user.username} tried to fetch data.`);
            return res.status(403).json({ msg: 'Account Suspended' });
        }

        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- 4. NEW: UI INTERACTION LOGGER ---
// This endpoint receives "Ghost Signals" from the frontend (clicks, checkboxes)
router.post('/log-ui', auth,  (req, res) => {
    const { action, details } = req.body;

    // 📝 LOG: Frontend Interaction
    // Example: "User QIAN1215: Ticked Compliance Checkbox"
    addLog('UI_INTERACTION', `User ${req.user.username}: ${action}`, details);

    res.sendStatus(200);
});

// GET /api/auth/status
// Lightweight check for polling
router.get('/status', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('isBanned banReason trustScore');
        if (!user) return res.status(404).json({ msg: 'User not found' });

        res.json({
            isBanned: user.isBanned,
            banReason: user.banReason,
            trustScore: user.trustScore
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/auth/reset-password
router.post('/reset-password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const user = await User.findById(req.user.id);
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ msg: "Invalid current password" });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ msg: "Password updated & logged to Sepolia Ledger!" });
    } catch (err) { res.status(500).send("Server Error"); }
});

module.exports = router;