// middleware/auth.js - ESM Version
import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // 🚨 Extension required

export default async function(req, res, next) {
    // 1. Get Token
    const token = req.header('x-auth-token');
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    try {
        // 2. Verify Signature
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mySuperSecretToken123');

        // 3. FETCH REAL-TIME USER DATA
        const user = await User.findById(decoded.user.id).select('-password');

        if (!user) {
            return res.status(401).json({ msg: 'Token valid, but User no longer exists.' });
        }

        // 4. GLOBAL BAN CHECK (The Security Layer)
        if (user.checkBanStatus && user.checkBanStatus()) {
            return res.status(403).json({
                msg: '⛔ Account Suspended.',
                reason: 'Trust Score too low or Manual Ban.',
                isBanned: true
            });
        }

        // Cooldown Logic (5 Minutes for Demo)
        const COOLDOWN_MS = 5 * 60 * 1000;

        if (user.trustScore < 50 && user.lastPenaltyDate) {
            const timeSincePenalty = Date.now() - new Date(user.lastPenaltyDate).getTime();

            if (timeSincePenalty > COOLDOWN_MS) {
                // HEAL THE USER
                user.trustScore = 50;
                user.lastPenaltyDate = null;
                await user.save();

                console.log(`[Auth Middleware] 🩹 User ${user.username} healed to 50 points.`);
            }
        }

        // 5. ATTACH FULL USER TO REQUEST
        req.user = user;

        next();
    } catch (err) {
        console.error(err);
        res.status(401).json({ msg: 'Token is not valid' });
    }
}