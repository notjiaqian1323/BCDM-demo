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
// 1. IMPORTANT: Make sure to import the safety enums at the top of your file!
const { VertexAI, HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
// 🧠 AI PROFILE CACHE (Saves API Tokens!)
// Stores data as: { "userId": { summary: "...", logCount: 42 } }
const aiProfileCache = {};


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

// --- 🤖 AI SECURITY SWEEP ROUTE ---
router.post('/ai-sweep', [auth, admin], async (req, res) => {
    try {
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID || 'your-google-cloud-project-id',
            location: process.env.GCP_LOCATION || 'us-central1'
        });

        const model = vertex_ai.preview.getGenerativeModel({
            model: 'gemini-2.5-flash', // (Or 2.0-flash depending on your region)
            generationConfig: {
                maxOutputTokens: 4000,
                temperature: 0.1,
            },
            // 🛡️ THE FIX: Tell the AI it is allowed to read "dangerous" security logs
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
            ],
        });

        // 2. Gather Context (Filter by 24 Hours)
        let rawLogs = getLogs();
        if (rawLogs instanceof Promise) rawLogs = await rawLogs;
        if (!Array.isArray(rawLogs)) rawLogs = rawLogs.logs || rawLogs.data || [];

        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        const now = Date.now();

        // Filter logs strictly to the last 24 hours
        const recentLogsArray = rawLogs.filter(log => {
            const logTime = new Date(log.timestamp || log.date).getTime();
            return (now - logTime) <= TWENTY_FOUR_HOURS;
        });

        // 🛑 VOLUME CHECK: Prevent wasteful API calls
        if (recentLogsArray.length < 5) {
            console.log("⏸️ [VERTEX AI] Sweep skipped. Insufficient log volume.");
            return res.json({
                analysis: "✅ <strong>System Quiet:</strong> Less than 5 events recorded in the past 24 hours. Insufficient data volume to warrant an AI threat sweep."
            });
        }

        // Map the top 50 most recent valid logs
        const recentLogsFormatted = recentLogsArray.slice(0, 50).map(log => {
            const time = log.timestamp || log.date ? new Date(log.timestamp || log.date).toISOString() : "Unknown";
            const user = log.userId || log.username || "System";
            const msg = log.message || log.details || "No message";
            return `[${time}] ${log.type || 'INFO'} - User: ${user} - ${msg}`;
        }).join('\n');

        // 3. The System Prompt (Upgraded for strict Regex targeting)
        const prompt = `
        You are a Cybersecurity SIEM Analyst for the BCDS Cloud System.
        Analyze the following recent system logs.
        
        Identify:
        1. Repeated failed authentications or rapid anomalies.
        2. Users uploading restricted/prohibited content.
        
        Keep your response under 4 sentences. Format using basic HTML for the dashboard.
        Use <strong> tags for emphasis. Do not use Markdown backticks.
        
        CRITICAL INSTRUCTION: If you identify a malicious user that should be banned, you MUST append their exact User ID at the very end of your response using this exact format:
        [FREEZE_TARGET: user_id]
        If multiple users need banning, output multiple tags like: [FREEZE_TARGET: user_id_1] [FREEZE_TARGET: user_id_2]
        If no anomalies are found, state that the system is secure and do not output any tags.
        
        Note: The account 'admin@bcds.com' is the system administrator. Some elevated actions are normal, but you should still flag severe anomalies. NEVER recommend freezing the system administrator.
        
        LOGS TO ANALYZE:
        ${recentLogsFormatted}
        `;

        // 4. Execute AI Call
        console.log(`\n🚀 [VERTEX AI] Sending ${recentLogsFormatted.split('\n').length} logs to Gemini...`);
        const response = await model.generateContent(prompt);

        // 🔍 THE DIAGNOSTIC DUMP: This prints the EXACT payload from Google to your terminal
        console.log("\n📦 [VERTEX AI RAW RESPONSE DUMP]:");
        console.dir(response, { depth: null, colors: true });

        // 🛡️ DEFENSIVE PARSING
        let aiResponseText = "⚠️ AI Analysis failed. No valid response returned.";
        const candidate = response?.response?.candidates?.[0];

        if (candidate?.content?.parts?.[0]?.text) {
            aiResponseText = candidate.content.parts[0].text;
            console.log("✅ [VERTEX AI] Successfully parsed text response.");

        } else if (candidate?.finishReason === 'SAFETY' || response?.response?.promptFeedback?.blockReason) {
            aiResponseText = "⚠️ <strong>Analysis Blocked:</strong> The AI safety filters blocked the response.";
            console.warn("🛑 [VERTEX AI] Blocked by Safety Filters.");

        } else {
            // If it fails, log exactly what we were trying to read
            console.warn("⚠️ [VERTEX AI] Parsing failed. 'candidates' array might be empty or missing.");
        }

        res.json({ analysis: aiResponseText });

    } catch (err) {
        console.error("💥 [VERTEX AI ERROR]:", err);
        res.status(500).json({ msg: "AI Sweep Failed", error: err.message });
    }
});

// --- 📈 GET USER TRUST SCORE TRAJECTORY ---
router.get('/user-chart/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Grab their logs
        let rawLogs = getLogs();
        if (rawLogs instanceof Promise) rawLogs = await rawLogs;
        if (!Array.isArray(rawLogs)) rawLogs = rawLogs.logs || rawLogs.data || [];

        const userLogs = rawLogs.filter(log => log.userId === req.params.id || log.username === user.username);

        // Generate the last 15 days of labels
        const labels = [];
        const dataPoints = [];
        let runningScore = 100; // Assume they started at 100

        const today = new Date();

        for (let i = 14; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            labels.push(d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }));

            // Look for violations on this specific day to drop the score
            const dayViolations = userLogs.filter(log => {
                const logDate = new Date(log.timestamp || log.date);
                return logDate.getDate() === d.getDate() && logDate.getMonth() === d.getMonth() && (log.type === 'CRITICAL' || log.type === 'SECURITY');
            });

            runningScore -= (dayViolations.length * 5); // Subtract 5 points per violation
            if (runningScore < user.trustScore) runningScore = user.trustScore; // Floor it to their actual current score

            dataPoints.push(runningScore);
        }

        // Force the final day to perfectly match their actual database score
        dataPoints[dataPoints.length - 1] = user.trustScore;

        res.json({ labels, dataPoints });

    } catch (err) {
        console.error("💥 [CHART ERROR]:", err);
        res.status(500).json({ labels: [], dataPoints: [] });
    }
});

// --- 🤖 GET USER SPECIFIC AI PROFILE ---
// --- 🤖 GET USER SPECIFIC AI PROFILE (WITH CACHING) ---
router.get('/ai-profile/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ analysis: "User not found." });

        // 1. Gather ONLY this user's logs
        let rawLogs = getLogs();
        if (rawLogs instanceof Promise) rawLogs = await rawLogs;
        if (!Array.isArray(rawLogs)) rawLogs = rawLogs.logs || rawLogs.data || [];

        const userLogsRaw = rawLogs.filter(log => log.userId === req.params.id || log.username === user.username);
        const currentLogCount = userLogsRaw.length;

        // 🛑 THE CACHE INTERCEPTOR: Check if we already analyzed this exact state
        if (aiProfileCache[req.params.id] && aiProfileCache[req.params.id].logCount === currentLogCount) {
            console.log(`⚡ [CACHE HIT] Returning saved AI profile for ${user.username}. Saved tokens!`);

            // Return the cached summary, plus a little UI badge so the admin knows it was cached
            return res.json({
                analysis: aiProfileCache[req.params.id].summary +
                    `<br><br><span style="font-size: 0.75rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;"><i class="fa-solid fa-bolt text-amber"></i> Loaded from Cache (No new activity)</span>`
            });
        }

        console.log(`🧠 [CACHE MISS] Generating new AI profile for ${user.username}...`);

        // 2. Format logs for the AI (Cap at 50)
        const userLogsFormatted = userLogsRaw.slice(0, 50).map(log => {
            const time = log.timestamp || log.date ? new Date(log.timestamp || log.date).toISOString() : "Unknown Time";
            return `[${time}] ${log.type || 'INFO'} - ${log.message || log.details}`;
        }).join('\n');

        // 3. Initialize Vertex AI & Prompt
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION || 'us-central1'
        });

        const model = vertex_ai.preview.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { maxOutputTokens: 3000, temperature: 0.2 },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
        });

        const prompt = `
        You are a Cybersecurity Profiler for the BCDS Cloud System.
        Write a concise, 3-sentence behavioral profile on the user: ${user.username} (Email: ${user.email}, Current Trust Score: ${user.trustScore}).
        
        Analyze their recent activity logs provided below.
        - Are they a normal user doing standard uploads?
        - Have they repeatedly violated policies or failed authentications?
        - What is your final recommendation for managing this user?
        
        Format your response using basic HTML (e.g., <strong>, <ul>, <br>). DO NOT use markdown. 
        If there are no logs, state that the user is new and lacks sufficient behavioral data.

        USER ACTIVITY LOGS:
        ${userLogsFormatted ? userLogsFormatted : 'No logs available for this user.'}
        `;

        const response = await model.generateContent(prompt);

        let aiResponseText = "⚠️ AI Profiling failed to generate.";
        const candidate = response?.response?.candidates?.[0];

        if (candidate?.content?.parts?.[0]?.text) {
            aiResponseText = candidate.content.parts[0].text;

            // 💾 SAVE TO CACHE FOR NEXT TIME!
            aiProfileCache[req.params.id] = {
                summary: aiResponseText,
                logCount: currentLogCount
            };

        } else if (candidate?.finishReason === 'SAFETY') {
            aiResponseText = "⚠️ <strong>Analysis Blocked:</strong> Safety filters triggered.";
        }

        res.json({ analysis: aiResponseText });

    } catch (err) {
        console.error("💥 [VERTEX AI PROFILE ERROR]:", err);
        res.status(500).json({ analysis: "⚠️ AI Agent Offline or Failed to Execute." });
    }
});

module.exports = router;