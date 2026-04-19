// routes/admin.js - ESM Version
import express from 'express';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';

// --- Local Imports (🚨 CRITICAL: .js extensions required) ---
import User from '../models/User.js';
import auth from '../middleware/auth.js';
import admin from '../middleware/admin.js';
import { addLog, getLogs, getUserLogs} from '../utils/logger.js';
import Log from '../models/Log.js';

const router = express.Router();

// 🧠 AI PROFILE CACHE
const aiProfileCache = {};

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email });

        if (!user) {
            addLog('SECURITY', `Failed Admin Login: ${email} (User not found)`);
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        if (user.role !== 'admin') {
            addLog('SECURITY', `🚨 UNAUTHORIZED ADMIN ATTEMPT: Standard user ${user.username} tried to access the Command Center.`);
            return res.status(403).json({ msg: 'Access Denied: Admin privileges required.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            addLog('SECURITY', `Failed Admin Login: ${user.username} (Wrong Password)`);
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        addLog('AUTH', `🛡️ Admin Login Success: ${user.username}`);
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🎩 ADMIN SECURE LOGIN: '${user.email}'`);

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

router.get('/logs' , [auth, admin], async (req, res) => {
    const logs = await getLogs(50);
    res.json(logs);
});

router.post('/log', (req, res) => {
    const { type, message } = req.body;
    addLog(type || 'INFO', message);
    res.sendStatus(200);
});

router.get('/risky', [auth, admin], async (req, res) => {
    try {
        const users = await User.find({ trustScore: { $lt: 90 } })
            .sort({ trustScore: 1 })
            .select('-password');
        res.json(users);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

router.get('/users', [auth, admin], async (req, res) => {
    try {
        const users = await User.find(
            {},
            '_id username email trustScore isBanned'
        ).sort({ trustScore: 1});
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/ban/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        if (user.isBanned) {
            if (user.trustScore < 20) {
                return res.status(400).json({
                    msg: "❌ Cannot Unfreeze: User Trust Score is Critical (< 20). System requires score recovery first."
                });
            }

            user.isBanned = false;
            user.banExpires = null;
            user.banReason = null;
            await user.save();

            addLog('ADMIN', `ADMIN UNBANNED User ${user.username}. Score: ${user.trustScore}`);
            return res.json({ msg: "User Unfrozen", user });
        }

        if (user.trustScore > 80) {
            return res.status(400).json({
                msg: "❌ Action Denied: User has High Trust Score (> 80). No suspicious activity detected."
            });
        }

        user.isBanned = true;
        user.banExpires = new Date(Date.now() + 2 * 60 * 1000);

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

router.get('/logs/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        let allLogs = getLogs();
        if (allLogs instanceof Promise) {
            allLogs = await allLogs;
        }
        if (!Array.isArray(allLogs)) {
            allLogs = allLogs.logs || allLogs.data || [];
        }

        const usernameLower = user.username.toLowerCase();
        const userLogs = allLogs.filter(log => {
            if (!log) return false;
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

router.get('/stats', [auth, admin], async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({});
        const atRiskUsers = await User.countDocuments({ trustScore: { $lt: 50 } });
        res.json({
            status: 'OPERATIONAL',
            total: totalUsers,
            risk: atRiskUsers
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

router.get('/analytics/traffic', auth, async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const trafficData = await Log.aggregate([
            { $match: { timestamp: { $gte: twentyFourHoursAgo } } },
            {
                $group: {
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

        const labels = [];
        const dataPoints = [];

        trafficData.forEach(bucket => {
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

router.post('/ai-sweep', [auth, admin], async (req, res) => {
    try {
        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID || 'your-google-cloud-project-id',
            location: process.env.GCP_LOCATION || 'us-central1'
        });

        const model = vertex_ai.preview.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                maxOutputTokens: 4000,
                temperature: 0.1,
            },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
        });

        let rawLogs = getLogs();
        if (rawLogs instanceof Promise) rawLogs = await rawLogs;
        if (!Array.isArray(rawLogs)) rawLogs = rawLogs.logs || rawLogs.data || [];

        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        const now = Date.now();

        const recentLogsArray = rawLogs.filter(log => {
            const logTime = new Date(log.timestamp || log.date).getTime();
            return (now - logTime) <= TWENTY_FOUR_HOURS;
        });

        if (recentLogsArray.length < 5) {
            return res.json({
                analysis: "✅ <strong>System Quiet:</strong> Less than 5 events recorded in the past 24 hours. Insufficient data volume to warrant an AI threat sweep."
            });
        }

        const recentLogsFormatted = recentLogsArray.slice(0, 50).map(log => {
            const time = log.timestamp || log.date ? new Date(log.timestamp || log.date).toISOString() : "Unknown";
            const user = log.userId || log.username || "System";
            const msg = log.message || log.details || "No message";
            return `[${time}] ${log.type || 'INFO'} - User: ${user} - ${msg}`;
        }).join('\n');

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
        
        LOGS TO ANALYZE:
        ${recentLogsFormatted}
        `;

        const response = await model.generateContent(prompt);
        let aiResponseText = "⚠️ AI Analysis failed. No valid response returned.";
        const candidate = response?.response?.candidates?.[0];

        if (candidate?.content?.parts?.[0]?.text) {
            aiResponseText = candidate.content.parts[0].text;
        } else if (candidate?.finishReason === 'SAFETY') {
            aiResponseText = "⚠️ <strong>Analysis Blocked:</strong> The AI safety filters blocked the response.";
        }

        res.json({ analysis: aiResponseText });

    } catch (err) {
        console.error("💥 [VERTEX AI ERROR]:", err);
        res.status(500).json({ msg: "AI Sweep Failed", error: err.message });
    }
});

router.get('/user-chart/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        let rawLogs = getLogs();
        if (rawLogs instanceof Promise) rawLogs = await rawLogs;
        if (!Array.isArray(rawLogs)) rawLogs = rawLogs.logs || rawLogs.data || [];

        const userLogs = rawLogs.filter(log => log.userId === req.params.id || log.username === user.username);
        const labels = [];
        const dataPoints = [];
        let runningScore = 100;
        const today = new Date();

        for (let i = 14; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            labels.push(d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }));

            const dayViolations = userLogs.filter(log => {
                const logDate = new Date(log.timestamp || log.date);
                return logDate.getDate() === d.getDate() && logDate.getMonth() === d.getMonth() && (log.type === 'CRITICAL' || log.type === 'SECURITY');
            });

            runningScore -= (dayViolations.length * 5);
            if (runningScore < user.trustScore) runningScore = user.trustScore;
            dataPoints.push(runningScore);
        }

        dataPoints[dataPoints.length - 1] = user.trustScore;
        res.json({ labels, dataPoints });
    } catch (err) {
        console.error("💥 [CHART ERROR]:", err);
        res.status(500).json({ labels: [], dataPoints: [] });
    }
});

router.get('/ai-profile/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ analysis: "User not found." });

        // 🚨 IMPROVEMENT 1: Fetch only logs for THIS user directly from DB
        const userLogsRaw = await getUserLogs(req.params.id, 50);
        const currentLogCount = userLogsRaw.length;

        // Check Cache
        if (aiProfileCache[req.params.id] && aiProfileCache[req.params.id].logCount === currentLogCount) {
            return res.json({
                analysis: aiProfileCache[req.params.id].summary +
                    `<br><br><span style="font-size: 0.75rem; color: var(--text-secondary);"><i class="fa-solid fa-bolt text-amber"></i> Loaded from Cache</span>`
            });
        }

        // 🚨 IMPROVEMENT 2: Rich Context Formatting
        // We include Location and Endpoint so the AI can detect patterns
        const userLogsFormatted = userLogsRaw.map(log => {
            const time = log.timestamp ? new Date(log.timestamp).toLocaleString('en-GB') : "Unknown Time";
            return `[${time}] ${log.type} - ${log.message} | Loc: ${log.location || 'Unknown'} | Action: ${log.endpoint || 'N/A'}`;
        }).join('\n');

        const vertex_ai = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION || 'us-central1'
        });

        const model = vertex_ai.getGenerativeModel({
            model: 'gemini-2.5-flash', // Using 1.5-flash is faster/cheaper for text summaries
        });

        const prompt = `
        You are a Cybersecurity Behavioral Analyst for the BCDS Cloud System.
        Analyze the following activity logs for User: ${user.username} (Trust Score: ${user.trustScore}).
        
        Write a 3-sentence professional security profile. 
        - Sentence 1: General behavior and frequency of access.
        - Sentence 2: Specific patterns (e.g., locations used, specific workspaces accessed).
        - Sentence 3: Risk assessment based on log types (e.g., presence of SECURITY or CRITICAL logs).

        USER ACTIVITY LOGS:
        ${userLogsFormatted || 'No logs found in database for this specific user.'}
        `;

        const result = await model.generateContent(prompt);
        const aiResponseText = result.response.candidates[0].content.parts[0].text;

        // Save to Cache
        aiProfileCache[req.params.id] = { summary: aiResponseText, logCount: currentLogCount };

        res.json({ analysis: aiResponseText });

    } catch (err) {
        console.error("💥 [VERTEX AI PROFILE ERROR]:", err);
        res.status(500).json({ analysis: "⚠️ AI Analysis Engine Timeout." });
    }
});

// @route   GET /api/admin/ai-health
// @desc    Verify GCP Service Account & Vertex AI Connectivity
router.get('/ai-health', auth, async (req, res) => {
    // 1. Double check the Environment Variable
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    console.log(`🔍 [AI-HEALTH] Checking Path: ${keyPath}`);

    // 2. Quick check if the file actually exists inside the container
    if (!fs.existsSync(keyPath)) {
        return res.status(500).json({
            status: "ERROR",
            message: "GCP Key file not found inside container. Check your Docker volume mount."
        });
    }

    try {
        // 3. Attempt a tiny "Hello World" with the Vertex AI SDK
        const vertexAI = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION || 'us-central1'
        });

        const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const testPrompt = "Respond with exactly the word 'READY' if you can hear me.";
        const result = await model.generateContent(testPrompt);
        const response = await result.response;
        const text = response.candidates[0].content.parts[0].text;

        if (text.includes("READY")) {
            return res.json({
                status: "AUTHENTICATED",
                message: "Vertex AI is linked and responding.",
                engine: "gemini-2.5-flash"
            });
        } else {
            throw new Error("Unexpected response from AI");
        }

    } catch (err) {
        console.error("💥 [AI-HEALTH] Authentication Failed:", err);
        res.status(401).json({
            status: "UNAUTHORIZED",
            message: "GCP Authentication failed. Check Service Account permissions.",
            error: err.message
        });
    }
});

// @route   GET /api/storage/audit
router.get('/audit', auth, async (req, res) => {
    console.log(`\n🕵️‍♂️ [AUDIT API] System-Wide Integrity Audit initiated by User: ${req.user.id}`);

    try {
        // 1. Fetch all active files owned by this user (or all files if this is a super-admin)
        const files = await File.find({ owner: req.user.id, isDeleted: false });

        let report = {
            totalFiles: files.length,
            verifiedCount: 0,
            tamperedCount: 0,
            anomalies: [],
            scanTime: new Date().toISOString()
        };

        if (files.length === 0) return res.json(report);

        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");

        // 2. Loop through and verify each file
        for (let file of files) {
            // If the file hasn't been anchored yet, skip it
            if (!file.ethTxHash) continue;

            try {
                const tx = await provider.getTransaction(file.ethTxHash);
                const localBlock = await BlockModel.findOne({ index: file.blockchainIndex });
                const onChainHash = tx ? tx.data.replace("0x", "") : null;

                if (onChainHash && localBlock && onChainHash === localBlock.hash) {
                    report.verifiedCount++;
                } else {
                    report.tamperedCount++;
                    report.anomalies.push({
                        fileId: file._id,
                        fileName: file.fileName,
                        issue: !localBlock ? "Local log missing" : "Hash mismatch"
                    });
                }
            } catch (err) {
                console.error(`⚠️ Error verifying file ${file.fileName}:`, err.message);
                report.tamperedCount++;
                report.anomalies.push({
                    fileId: file._id,
                    fileName: file.fileName,
                    issue: "Blockchain unreachable or tx missing"
                });
            }
        }

        console.log(`✅ [AUDIT API] Audit Complete. Verified: ${report.verifiedCount}, Tampered: ${report.tamperedCount}`);
        res.json(report);

    } catch (err) {
        console.error("💥 [AUDIT API] CRITICAL ERROR:", err);
        res.status(500).json({ msg: "System Audit Failed" });
    }
});

export default router;