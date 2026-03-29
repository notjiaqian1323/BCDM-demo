// routes/activity.js - ESM Version
import express from 'express';
const router = express.Router();

// --- Local Imports (🚨 CRITICAL: .js extensions required) ---
import auth from '../middleware/auth.js';
import Activity from '../models/Activity.js';

// @route   GET /api/activity
router.get('/', auth, async (req, res) => {
    try {
        // THE FIX: Filter by the ID inside the JWT token
        const activities = await Activity.find({ userId: req.user.id })
            .sort({ date: -1 })
            .limit(10);

        res.json(activities);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

export default router;