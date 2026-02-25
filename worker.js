// worker.js
const Queue = require('bull');
const mongoose = require('mongoose');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

// Models & Utils
const File = require('./models/File');
const User = require('./models/User');
const { decryptBuffer, encryptBuffer } = require('./utils/encryption');
const LOG_URL = 'http://localhost:5000/api/admin/log';

require('dotenv').config();

// Helper Function
async function logToAdmin(type, message) {
    console.log(`[WORKER] ${message}`); // Keep terminal log
    try {
        await axios.post(LOG_URL, { type, message });
    } catch (e) { /* Ignore connection errors */ }
}

// --- LOGGING HELPERS ---
const logWorker = (msg, data = {}) => {
    console.log(`[${new Date().toISOString()}] 👷 [WORKER] ${msg}`, JSON.stringify(data));
};

const logError = (msg, error) => {
    console.error(`[${new Date().toISOString()}] ❌ [WORKER ERROR] ${msg}`, error.message || error);
};

// --- CONFIGURATION ---
logWorker('Initializing Worker...');

mongoose.connect(process.env.MONGO_URI)
    .then(() => logWorker("Connected to MongoDB"))
    .catch(err => logError("DB Connection Failed", err));

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// --- REDIS CONNECTION (EXPLICIT) ---
// We use the same config as the server to ensure they talk to the same queue
const complianceQueue = new Queue('compliance-scanning', {
    redis: { port: 6379, host: '127.0.0.1' }
});

const BLOCKCHAIN_API_URL = 'http://localhost:5000/api/blockchain/log';

// --- QUEUE EVENT LISTENERS (Debug Redis) ---
complianceQueue.on('error', (err) => logError('Redis Connection Error', err));
complianceQueue.on('failed', (job, err) => logError(`Job ${job.id} failed`, err));
complianceQueue.on('ready', () => logWorker('Ready to accept jobs!'));

logWorker("Compliance Worker is running and waiting for jobs...");

// --- MAIN PROCESSOR ---
complianceQueue.process(async (job) => {
    const { fileId, s3Key, originalName, userId } = job.data;
    logWorker(`JOB STARTED: ${job.id}`, { file: originalName, user: userId });
    // 1. Log Start
    await logToAdmin('WORKER', `Job Started: Scanning ${originalName}...`);

    try {
        // 1. UPDATE STATUS
        await File.findByIdAndUpdate(fileId, { complianceStatus: 'scanning' });
        logWorker(`Job ${job.id}: Status updated to 'scanning'`);

        // 2. PREPARE TEMP FILES
        const tempInput = path.join(__dirname, 'temp', `in_${job.id}.pdf`);
        const tempOutput = path.join(__dirname, 'temp', `out_${job.id}.pdf`);

        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'));
        }

        // 3. DOWNLOAD FROM S3
        logWorker(`Job ${job.id}: Downloading from S3...`, { key: s3Key });
        const s3Object = await s3.getObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();

        logWorker(`Job ${job.id}: Decrypting file...`);
        const decryptedBuffer = decryptBuffer(s3Object.Body);
        fs.writeFileSync(tempInput, decryptedBuffer);
        logWorker(`Job ${job.id}: File saved locally`, { size: decryptedBuffer.length });

        // 4. RUN PYTHON NLP
        logWorker(`Job ${job.id}: Launching Python NLP Engine...`);
        const jsonResult = await new Promise((resolve, reject) => {
            const py = spawn('python', ['nlp_engine.py', tempInput, tempOutput]);

            let output = '';
            let errorLog = '';

            py.stdout.on('data', (data) => output += data.toString());
            py.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                errorLog += msg + '\n';
                // Print Python logs in REAL-TIME so you can see what's happening
                console.log(`🐍 [PYTHON] ${msg}`);
            });

            py.on('close', (code) => {
                if (code === 0) {
                    logWorker(`Job ${job.id}: Python finished successfully`);
                    resolve(output);
                } else {
                    logError(`Job ${job.id}: Python script failed`, errorLog);
                    reject(new Error(`Python exit code ${code}`));
                }
            });
        });

        // 5. PARSE RESULTS
        let report = [];
        let riskMeta = { risk_score: 100, classification: "PUBLIC", keywords_found: [] };

        try {
            const parsed = JSON.parse(jsonResult);
            // Check if it's the new format with 'meta'
            if (parsed.findings) {
                report = parsed.findings;
                riskMeta = parsed.meta;
            } else {
                report = parsed; // Fallback for old format
            }
            logWorker(`Job ${job.id}: NLP Report parsed`, { findings: report.length, class: riskMeta.classification });
        } catch (e) {
            logError(`Job ${job.id}: Failed to parse JSON`, jsonResult);
            report = [];
        }

        // 6. PENALTY LOGIC
        const violations = report.length;
        const user = await User.findById(userId);

        if (user) {
            if (riskMeta.classification === 'INTERNAL' || riskMeta.classification === 'RESTRICTED') {

                const penalty = 20; // Heavy penalty
                user.trustScore = Math.max(0, user.trustScore - penalty);
                user.violationCount += 1;

                await logToAdmin('CRITICAL', `🚨 PII FOUND! User ${userId} penalized. ${violations} violations detected.`);

                if (user.trustScore === 0) {
                    user.isBanned = true;
                    user.banExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
                    logWorker(`Job ${job.id}: 💀 USER BANNED`, { email: user.email });
                }

                user.trustScore = Math.max(0, user.trustScore - penalty);
                user.lastPenaltyDate = Date.now(); //
                await user.save();
                logWorker(`Job ${job.id}: ⚠️ User penalized`, { penalty, newScore: user.trustScore });

                // Blockchain Logging
                try {
                    await axios.post(BLOCKCHAIN_API_URL, {
                        type: "REPUTATION_PENALTY",
                        details: {
                            userId: user._id,
                            fileId: fileId,
                            violations: violations,
                            newScore: user.trustScore,
                            reason: "PII Found"
                        }
                    });
                    logWorker(`Job ${job.id}: ✅ Blockchain updated`);
                } catch (bcErr) {
                    logError(`Job ${job.id}: Blockchain log failed`, bcErr.message);
                }

            } else {
                // Reward Logic
                await logToAdmin('SUCCESS', `✅ Scan Clean. No PII found in ${originalName}.`);

                if (user.trustScore < 100) {
                    user.trustScore += 1;
                    await user.save();
                    logWorker(`Job ${job.id}: ⭐ User rewarded (+1)`);
                }
            }
        }

        // 7. HANDLE REDACTION & CLEANUP
        if (fs.existsSync(tempOutput)) {
            logWorker(`Job ${job.id}: Redacted file found. Encrypting & Uploading...`);
            const redactedBuffer = fs.readFileSync(tempOutput);
            const encryptedRedacted = encryptBuffer(redactedBuffer);

            const newS3Key = s3Key.replace('.enc', '_redacted.enc');
            await s3.upload({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: newS3Key,
                Body: encryptedRedacted
            }).promise();

            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'redacted',
                redactedS3Key: newS3Key,
                piiReport: report
            });
            logWorker(`Job ${job.id}: ✅ Process Complete (Redacted)`);

        } else {
            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'clean',
                piiReport: report
            });
            logWorker(`Job ${job.id}: ✅ Process Complete (Clean)`);
        }

    } catch (err) {
        logError(`Job ${job.id}: CRITICAL FAILURE`, err);
        await File.findByIdAndUpdate(fileId, { complianceStatus: 'failed' });
    } finally {
        // Cleanup
        //if (fs.existsSync(path.join(__dirname, 'temp', `in_${job.id}.pdf`))) {
        //    fs.unlinkSync(path.join(__dirname, 'temp', `in_${job.id}.pdf`));
        //}
        //if (fs.existsSync(path.join(__dirname, 'temp', `out_${job.id}.pdf`))) {
        //    fs.unlinkSync(path.join(__dirname, 'temp', `out_${job.id}.pdf`));
        //}
    }
});