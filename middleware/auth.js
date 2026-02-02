const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Import User model

module.exports = async function(req, res, next) {
    // 1. Get Token
    const token = req.header('x-auth-token');
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    try {
        // 2. Verify Signature
        const decoded = jwt.verify(token, 'mysecrettoken');

        // 3. FETCH REAL-TIME USER DATA (The Upgrade)
        // We select only the fields we need for checks
        const user = await User.findById(decoded.user.id).select('-password');

        if (!user) {
            return res.status(401).json({ msg: 'Token valid, but User no longer exists.' });
        }

        // 4. GLOBAL BAN CHECK (The Security Layer)
        // If banned, reject EVERY request immediately
        if (user.checkBanStatus && user.checkBanStatus()) {
            return res.status(403).json({
                msg: '⛔ Account Suspended.',
                reason: 'Trust Score too low or Manual Ban.',
                isBanned: true
            });
        }

        // If score is low (< 50) AND it has been X minutes since last penalty...
        // Let's say: 5 Minutes Cooldown for Demo (In real life: 24 Hours)
        const COOLDOWN_MS = 5 * 60 * 1000;

        if (user.trustScore < 50 && user.lastPenaltyDate) {
            const timeSincePenalty = Date.now() - new Date(user.lastPenaltyDate).getTime();

            if (timeSincePenalty > COOLDOWN_MS) {
                // HEAL THE USER
                // Reset them to exactly 50 (Probation) so they can try again.
                // Or add +10 points. Let's do reset to 50.
                user.trustScore = 50;
                user.lastPenaltyDate = null; // Clear penalty date
                await user.save();

                console.log(`[Auth Middleware] 🩹 User ${user.username} healed to 50 points.`);
            }
        }

        // 5. ATTACH FULL USER TO REQUEST
        // Now 'req.user' is the actual database object, not just an ID!
        req.user = user;

        next();
    } catch (err) {
        console.error(err);
        res.status(401).json({ msg: 'Token is not valid' });
    }
};