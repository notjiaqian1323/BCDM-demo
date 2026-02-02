// routes/storage.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const multer = require('multer');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const File = require('../models/File');
const User = require('../models/User');
const { encryptBuffer, decryptBuffer } = require('../utils/encryption');
const auth = require('../middleware/auth');
const Queue = require('bull');
const axios = require('axios');
const { addLog } = require('../utils/logger');

// --- CONFIGURATION ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const complianceQueue = new Queue('compliance-scanning', 'redis://127.0.0.1:6379');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION
});

// --- HELPER FOR CONSISTENT LOGGING ---
const logEvent = (route, msg, data = {}) => {
    console.log(`[${new Date().toISOString()}] ℹ️  [${route}] ${msg}`, JSON.stringify(data));
};

const logError = (route, msg, error) => {
    console.error(`[${new Date().toISOString()}] ❌ [${route}] ${msg}`, error.message || error);
};

// =========================================================================
// 1. UPLOAD ROUTE (The Critical Path)
// =========================================================================
router.post('/upload', [auth, upload.single('file')], async (req, res) => {
    const ROUTE = 'POST /upload';
    logEvent(ROUTE, 'Request received');

    try {
        const user = req.user;
        // 1. GET TOGGLE STATUS (Frontend sends string 'true' or 'false')
        // Note: Multer parses the text fields along with the file
        const runCompliance = req.body.runCompliance === 'true';

        logEvent(ROUTE, `User authenticated`, { userId: user.id, username: user.username, runCompliance });

        // 2. Check for File Presence
        if (!req.file) {
            logError(ROUTE, 'No file attached');
            return res.status(400).json({ msg: 'No file uploaded' });
        }
        logEvent(ROUTE, `File details received`, {
            name: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });

        // 3. Trust Score Check (Global Gatekeeper)
        // If score is extremely low (< 20), maybe block ALL uploads.
        // For now, we keep your existing rule: < 50 blocks EVERYTHING.
        if (user.trustScore < 50) {
            logError(ROUTE, `Trust score blocked`, { score: user.trustScore, threshold: 50 });
            addLog('SECURITY', `🚫 BLOCKED UPLOAD: User ${user.username} (Score: ${user.trustScore}) tried to upload.`);
            return res.status(403).json({
                msg: "⚠️ Trust Score too low. Upload permission revoked.",
                currentScore: user.trustScore
            });
        }

        // 4. Rate Limiting
        const now = Date.now();
        if (user.lastUploadTime && (now - user.lastUploadTime.getTime()) < 5000) {
            logEvent(ROUTE, `Rate limit hit. Applying penalty.`, { userId: user.id });
            addLog('SECURITY', `Rate Limit Triggered by ${user.username}. Penalty applied.`);

            user.trustScore = Math.max(0, user.trustScore - 2);
            user.rapidUploadSpamCount += 1;
            user.lastPenaltyDate = Date.now();
            await user.save();

            logEvent(ROUTE, `Penalty applied`, { newScore: user.trustScore });
            return res.status(429).json({
                msg: "🚫 Slow down! You are uploading too fast. Trust score penalized.",
                currentScore: user.trustScore
            });
        }

        user.lastUploadTime = now;
        await user.save();

        // 5. Storage Limit Check
        const currentUsage = user.storageUsed || 0;
        if (currentUsage + req.file.size > user.storageLimit) {
            addLog('WARN', `Storage Quota Exceeded: User ${user.username} failed to upload "${req.file.originalname}".`);
            logError(ROUTE, `Storage limit exceeded`, { used: currentUsage, incoming: req.file.size, limit: user.storageLimit });
            return res.status(400).json({ msg: `🚫 Storage Limit Exceeded!` });
        }

        // 6. Encrypt & Upload to S3
        logEvent(ROUTE, 'Starting encryption...');
        const encryptedFileBuffer = encryptBuffer(req.file.buffer);

        logEvent(ROUTE, 'Uploading to AWS S3...');
        const s3Params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${user.id}/${Date.now()}_${req.file.originalname}.enc`,
            Body: encryptedFileBuffer
        };
        const s3Data = await s3.upload(s3Params).promise();
        logEvent(ROUTE, 'S3 Upload successful', { s3Key: s3Data.Key });

        // 7. Save Metadata to DB (CONDITIONAL STATUS)
        logEvent(ROUTE, 'Saving file metadata to MongoDB...');

        // If toggle is ON -> 'pending' (Worker will pick it up)
        // If toggle is OFF -> 'skipped' (Worker ignores it)
        const initialStatus = runCompliance ? 'pending' : 'skipped';

        const newFile = new File({
            userId: user.id,
            fileName: req.file.originalname,
            s3Key: s3Data.Key,
            fileSize: req.file.size,
            complianceStatus: initialStatus
        });
        const file = await newFile.save();
        logEvent(ROUTE, 'DB Save successful', { fileId: file._id, status: initialStatus });

        const mode = runCompliance ? "ENABLED" : "DISABLED";

        // 8. Trigger Worker Queue (ONLY IF CHECKED)
        if (runCompliance) {
            logEvent(ROUTE, 'Compliance Checkbox ENABLED. Adding job to Queue...');

            await complianceQueue.add({
                fileId: file._id,
                userId: user.id,
                s3Key: file.s3Key,
                originalName: file.fileName
            });
            logEvent(ROUTE, 'Job queued successfully');
        } else {
            logEvent(ROUTE, 'Compliance Checkbox DISABLED. Skipping Queue.');
        }

        // --- 9. LOG TO BLOCKCHAIN (NEW STEP) ---
        // We log this event regardless of scan status
        logEvent(ROUTE, 'Logging event to Blockchain...');
        try {
            await axios.post('http://localhost:5000/api/blockchain/log', {
                type: "FILE_UPLOAD",
                details: {
                    userId: user.id,
                    fileId: file._id,
                    fileName: file.fileName,
                    fileSize: file.fileSize,
                    s3Key: file.s3Key, // Encrypted location
                    complianceMode: runCompliance ? "ENABLED" : "DISABLED",
                    timestamp: new Date().toISOString()
                }
            });
            logEvent(ROUTE, 'Blockchain log successful');
        } catch (bcErr) {
            // Note: We catch errors here so the user still gets their file uploaded
            // even if the blockchain service blips.
            logError(ROUTE, 'Blockchain logging failed', bcErr);
        }

        // 10. Update User Usage
        user.storageUsed += req.file.size;
        await user.save();
        logEvent(ROUTE, 'User storage usage updated');
        addLog('UPLOAD', `User ${user.username} uploaded "${req.file.originalname}". Compliance: [${mode}]`);
        res.json({
            msg: runCompliance ? 'File Uploaded. Compliance scan started.' : 'File Uploaded (Scan Skipped).',
            file: file
        });
        logEvent(ROUTE, 'Response sent to client');

    } catch (err) {
        logError(ROUTE, 'Critical Failure', err);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
});

// =========================================================================
// 2. DOWNLOAD ROUTE
// =========================================================================
router.get('/download/:fileId', auth, async (req, res) => {
    const ROUTE = `GET /download/${req.params.fileId}`;
    logEvent(ROUTE, 'Request received', { userId: req.user.id });

    try {
        const file = await File.findById(req.params.fileId);
        if (!file) {
            logError(ROUTE, 'File not found in DB');
            addLog('WARN', `Download 404: User ${req.user.username} tried to access invalid File ID: ${req.params.fileId}`);
            return res.status(404).json({ msg: "File not found" });
        }

        if (file.userId.toString() !== req.user.id) {
            logError(ROUTE, 'Authorization Failed: User mismatch');
            addLog('SECURITY', `🚫 UNAUTHORIZED ACCESS: User ${req.user.username} tried to download file "${file.fileName}" belonging to another user.`);
            return res.status(401).json({ msg: "Not authorized" });
        }

        logEvent(ROUTE, 'Fetching from S3...', { s3Key: file.s3Key });
        const s3Params = { Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key };
        const s3Object = await s3.getObject(s3Params).promise();

        logEvent(ROUTE, 'Decrypting file...');
        const decryptedBuffer = decryptBuffer(s3Object.Body);

        res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
        res.send(decryptedBuffer);
        logEvent(ROUTE, 'File sent to client');
        addLog('ACCESS', `User ${req.user.username} DOWNLOADED file "${file.fileName}"`);

    } catch (err) {
        addLog('ERROR', `Download System Failed for ${req.user ? req.user.username : 'Unknown'}: ${err.message}`);
        logError(ROUTE, 'Download Failed', err);
        res.status(500).json({ msg: "Error", error: err.message });
    }
});

// =========================================================================
// 3. LIST FILES ROUTE
// =========================================================================
router.get('/files', auth, async (req, res) => {
    const ROUTE = 'GET /files';
    logEvent(ROUTE, 'Listing files for user', { userId: req.user.id });

    try {
        const files = await File.find({ userId: req.user.id }).sort({ uploadDate: -1 });
        logEvent(ROUTE, `Found ${files.length} files`);
        res.json(files);
    } catch (err) {
        logError(ROUTE, 'Database Query Failed', err);
        res.status(500).json({ error: err.message });
    }
});

// =========================================================================
// 4. DELETE ROUTE
// =========================================================================
router.delete('/files/:id', auth, async (req, res) => {
    const ROUTE = `DELETE /files/${req.params.id}`;
    logEvent(ROUTE, 'Request received', { userId: req.user.id });

    try {
        const file = await File.findById(req.params.id);
        if (!file) {
            logError(ROUTE, 'File not found');
            addLog('WARN', `Delete Failed: User ${req.user.username} tried to delete non-existent File ID.`);
            return res.status(404).json({ msg: "File not found" });
        }

        if (file.userId.toString() !== req.user.id) {
            logError(ROUTE, 'Unauthorized attempt');
            addLog('SECURITY', `🚫 UNAUTHORIZED DELETE: User ${req.user.username} tried to destroy file "${file.fileName}" belonging to another user.`);
            return res.status(401).json({ msg: "Not authorized" });
        }

        logEvent(ROUTE, 'Deleting Original from S3...', { key: file.s3Key });
        await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key }).promise();

        if (file.redactedS3Key) {
            logEvent(ROUTE, 'Deleting Redacted version from S3...', { key: file.redactedS3Key });
            await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.redactedS3Key }).promise();
        }

        logEvent(ROUTE, 'Deleting metadata from DB...');
        await File.findByIdAndDelete(req.params.id);

        // Update Storage
        const user = req.user;
        user.storageUsed -= file.fileSize;
        if (user.storageUsed < 0) user.storageUsed = 0;
        await user.save();
        logEvent(ROUTE, 'User storage quota updated');

        addLog('WARN', `User ${user.username} DELETED file "${file.fileName}" (Freed ${(file.fileSize/1024).toFixed(1)} KB).`);
        res.json({ msg: "Deleted" });

    } catch (err) {
        addLog('ERROR', `Delete System Failed for ${req.user ? req.user.username : 'Unknown'}: ${err.message}`);
        logError(ROUTE, 'Delete Failed', err);
        res.status(500).json({ error: err.message });
    }
});

// =========================================================================
// 5. SHARE LINK ROUTE
// =========================================================================
router.post('/share/:id', auth, async (req, res) => {
    const ROUTE = `POST /share/${req.params.id}`;
    logEvent(ROUTE, 'Share request received');

    try {
        const user = req.user;

        if (user.trustScore < 50) {
            addLog('SECURITY', `🚫 BLOCKED SHARE: User ${user.username} (Score: ${user.trustScore}) tried to generate a public link.`);
            logError(ROUTE, 'Sharing blocked due to Low Trust Score');
            return res.status(403).json({
                msg: "⚠️ Sharing Disabled. Your Trust Score is too low.",
                currentScore: user.trustScore
            });
        }

        const file = await File.findById(req.params.id);
        if (!file) {
            addLog('WARN', `Share Failed: User ${user.username} tried to share invalid File ID.`);
            return res.status(404).json({ msg: "File not found" });
        }

        if (file.userId.toString() !== user.id) {
            addLog('SECURITY', `🚫 UNAUTHORIZED SHARE: User ${user.username} tried to create a link for someone else's file "${file.fileName}".`);
            return res.status(401).json({ msg: "Not authorized" });
        }

        if (file.complianceStatus === 'redacted' || file.complianceStatus === 'failed') {
            addLog('CRITICAL', `🛡️ DLP BLOCK: Stopped ${user.username} from sharing sensitive file "${file.fileName}" (Status: ${file.complianceStatus}).`);
            logError(ROUTE, 'Sharing blocked due to Compliance Status', { status: file.complianceStatus });
            return res.status(403).json({
                msg: "⚠️ Cannot share this file. It contains sensitive PII or failed compliance."
            });
        }

        logEvent(ROUTE, 'Generating share token...');
        const token = crypto.randomBytes(16).toString('hex');
        const expires = new Date();
        expires.setHours(expires.getHours() + 24);

        file.shareToken = token;
        file.shareExpires = expires;
        await file.save();

        addLog('ACCESS', `User ${user.username} created PUBLIC LINK for "${file.fileName}". Expires in 24h.`);
        logEvent(ROUTE, 'Share link generated', { token: token });
        res.json({ link: `http://localhost:5000/api/storage/public/${token}` });

    } catch (err) {
        addLog('ERROR', `Share System Failed for ${req.user ? req.user.username : 'Unknown'}: ${err.message}`);
        logError(ROUTE, 'Share generation failed', err);
        res.status(500).json({ error: err.message });
    }
});

// =========================================================================
// 6. PUBLIC DOWNLOAD ROUTE
// =========================================================================
router.get('/public/:token', async (req, res) => {
    const ROUTE = `GET /public/${req.params.token}`;
    logEvent(ROUTE, 'Public access attempt');

    try {
        const file = await File.findOne({ shareToken: req.params.token });

        if (!file) {
            logError(ROUTE, 'Invalid Token');
            return res.status(404).json({ msg: "Invalid Link" });
        }

        if (new Date() > file.shareExpires) {
            logError(ROUTE, 'Token Expired');
            return res.status(410).json({ msg: "This link has expired." });
        }

        logEvent(ROUTE, 'Token Valid. Fetching from S3...', { s3Key: file.s3Key });

        const s3Params = { Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key };
        const s3Object = await s3.getObject(s3Params).promise();
        const decryptedBuffer = decryptBuffer(s3Object.Body);

        res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
        res.send(decryptedBuffer);
        logEvent(ROUTE, 'Public file served');

    } catch (err) {
        logError(ROUTE, 'Public download failed', err);
        res.status(500).json({ msg: "Error downloading shared file" });
    }
});

// =========================================================================
// 7. STATUS CHECK ROUTE
// =========================================================================
router.get('/status/:fileId', auth, async (req, res) => {
    const ROUTE = `GET /status/${req.params.fileId}`;
    // Reduced logging here to avoid spamming console if polling frequently
    // logEvent(ROUTE, 'Status check');

    try {
        // 🛡️ SECURITY CHECK: Is this even a valid ID format?
        if (!mongoose.Types.ObjectId.isValid(req.params.fileId)) {
            // logError(ROUTE, 'Invalid File ID format received'); // Optional
            return res.status(400).json({ msg: "Invalid File ID" });
        }

        const file = await File.findById(req.params.fileId);
        if (!file) return res.status(404).json({ msg: "File not found" });


        res.json({
            status: file.complianceStatus,
            report: file.piiReport
        });
    } catch (err) {
        logError(ROUTE, 'Status check failed', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;