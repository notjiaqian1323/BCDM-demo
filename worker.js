// worker.js
const Queue = require('bull');
const mongoose = require('mongoose');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Models & Utils
const File = require('./models/File');
const User = require('./models/User');
const { decryptBuffer, encryptBuffer } = require('./utils/encryption');
const LOG_URL = 'http://localhost:5002/api/admin/log';

require('dotenv').config();

// Helper Function
async function logToAdmin(type, message) {
    console.log(`[WORKER] ${message}`);
    try { await axios.post(LOG_URL, { type, message }); }
    catch (e) { /* Ignore connection errors */ }
}

const logWorker = (msg, data = {}) => console.log(`[${new Date().toISOString()}] 👷 [WORKER] ${msg}`, JSON.stringify(data));
const logError = (msg, error) => console.error(`[${new Date().toISOString()}] ❌ [WORKER ERROR] ${msg}`, error.message || error);

// --- CONFIGURATION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => logWorker("Connected to MongoDB"))
    .catch(err => logError("DB Connection Failed", err));

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// 🐛 THE FIX: Queue name MUST match the upload route ('nlp-scanning')
const nlpQueue = new Queue('nlp-scanning', process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const BLOCKCHAIN_API_URL = 'http://localhost:5002/api/blockchain/log';

nlpQueue.on('error', (err) => logError('Redis Connection Error', err));
nlpQueue.on('failed', (job, err) => logError(`Job ${job.id} failed`, err));
nlpQueue.on('ready', () => logWorker('Ready to accept jobs!'));

logWorker("Compliance Worker is running and waiting for jobs...");

// --- MAIN PROCESSOR ---
nlpQueue.process(async (job) => {
    const { fileId, s3Key, originalName, userId } = job.data;
    logWorker(`JOB STARTED: ${job.id}`, { file: originalName, user: userId });
    await logToAdmin('WORKER', `Job Started: Scanning ${originalName}...`);

    // Ensure temp directory exists
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const tempInput = path.join(tempDir, `in_${job.id}.pdf`);
    const tempOutput = path.join(tempDir, `out_${job.id}.pdf`);

    try {
        await File.findByIdAndUpdate(fileId, { complianceStatus: 'scanning' });

        // 1. DOWNLOAD FROM S3
        logWorker(`Job ${job.id}: Downloading from S3...`);
        const s3Object = await s3.getObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();

        // Note: Assuming your encryption util gracefully handles unencrypted buffers if needed
        //const decryptedBuffer = decryptBuffer(s3Object.Body);
        fs.writeFileSync(tempInput, s3Object.Body);


        // 2. RUN PYTHON NLP (Via Fast Microservice)
        logWorker(`Job ${job.id}: Sending to Python AI Microservice...`);
        let jsonResult;

        try {
            // Post the file paths to our new Python API running on port 8000
            const response = await axios.post('http://127.0.0.1:8000/scan', {
                input_path: tempInput,
                output_path: tempOutput
            });

            // Axios automatically parses the JSON response for us!
            jsonResult = response.data;
            logWorker(`Job ${job.id}: Python Microservice finished successfully`);

        } catch (apiError) {
            // If Python throws an HTTPException, we catch it here
            const errorMsg = apiError.response ? apiError.response.data.detail : apiError.message;
            logError(`Job ${job.id}: Python Microservice failed`, errorMsg);
            throw new Error(`AI Scan Failed: ${errorMsg}`);
        }

        // 3. PARSE RESULTS
        // Because Axios parsed the JSON, we don't need a try/catch JSON.parse() anymore.
        let report = jsonResult.findings || [];
        let riskMeta = jsonResult.meta || { risk_score: 100, classification: "PUBLIC", keywords_found: [] };

        const user = await User.findById(userId);
        if (!user) throw new Error("User not found");

        // 🛑 4. CRITICAL: DATA LOSS PREVENTION (DLP)
        if (riskMeta.classification === 'INTERNAL' || riskMeta.classification === 'RESTRICTED') {
            logWorker(`Job ${job.id}: ⛔ RESTRICTED CONTENT DETECTED. Executing DLP protocols.`);

            // Delete from AWS
            await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();

            // Update DB
            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'rejected',
                riskScore: riskMeta.risk_score,
                classification: riskMeta.classification,
                riskKeywords: riskMeta.keywords_found,
                rejectionReason: `Policy Violation: Restricted keywords found.`
            });

            // Penalize User
            const penalty = 20;
            user.trustScore = Math.max(0, user.trustScore - penalty);
            user.violationCount += 1;

            if (user.trustScore === 0) {
                user.isBanned = true;
                user.banExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
            }
            await user.save();
            await logToAdmin('CRITICAL', `⛔ FILE REJECTED! User ${userId} uploaded restricted content.`);

            // Exit early - do not proceed to redaction
            return;
        }

        // ⚠️ 5. STANDARD: PII REDACTION
        const violations = report.length;
        if (violations > 0) {
            const penalty = Math.min(violations, 5); // Max 5 points for PII
            user.trustScore = Math.max(0, user.trustScore - penalty);
            user.violationCount += 1;
            await user.save();
            await logToAdmin('WARNING', `⚠️ PII Redacted. User penalized -${penalty}.`);

            // Upload Redacted File
            // Upload Redacted File
            if (fs.existsSync(tempOutput)) {
                const redactedBuffer = fs.readFileSync(tempOutput);

                // 🛑 CRITICAL FIX: If you aren't encrypting the initial upload,
                // do not encrypt the redacted one, or it will download as garbage bytes!
                // const encryptedRedacted = encryptBuffer(redactedBuffer);

                const newS3Key = s3Key.includes('.') ? s3Key.replace(/\.[^/.]+$/, "_redacted$&") : s3Key + '_redacted';

                await s3.upload({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: newS3Key,
                    Body: redactedBuffer // <--- Using the raw buffer instead of encrypted
                }).promise();

                // 🗑️ CRITICAL S3 CLEANUP: Delete the original dangerous file!
                logWorker(`Job ${job.id}: 🧹 Deleting original unredacted file from S3...`);
                await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();

                await File.findByIdAndUpdate(fileId, {
                    complianceStatus: 'redacted',
                    s3Key: newS3Key, // 🛡️ OVERWRITE the main s3Key so the download route gets the safe file!
                    redactedS3Key: newS3Key,
                    piiReport: report,
                    riskScore: riskMeta.risk_score,
                    classification: riskMeta.classification
                });
            }
        } else {
            // ✅ 6. CLEAN FILE
            if (user.trustScore < 100) {
                user.trustScore += 1;
                await user.save();
            }
            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'clean',
                piiReport: report,
                riskScore: riskMeta.risk_score,
                classification: riskMeta.classification
            });
            await logToAdmin('SUCCESS', `✅ Scan Clean: ${originalName}`);
        }

    } catch (err) {
        logError(`Job ${job.id}: CRITICAL FAILURE`, err);
        await File.findByIdAndUpdate(fileId, { complianceStatus: 'failed' });
    } finally {
        // 7. CLEANUP TEMP FILES
        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    }
});