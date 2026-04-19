// worker.js - ESM Version
import Queue from 'bull';
import mongoose from 'mongoose';
import AWS from 'aws-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import dotenv from 'dotenv';

// --- 1. MODELS & UTILS (🚨 CRITICAL: .js extensions required) ---
import File from './models/File.js';
import User from './models/User.js';
import { decryptBuffer, encryptBuffer } from './utils/encryption.js';

// --- 2. ESM SETUP (__dirname shim) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// 🚨 DOCKER FIX: Point to the API Server container, not localhost
const BASE_API_URL = process.env.API_SERVER_URL || 'http://api-server:5001';
const LOG_URL = `${BASE_API_URL}/api/admin/log`;
const BLOCKCHAIN_API_URL = `${BASE_API_URL}/api/blockchain/log`;

// Helper Function
async function logToAdmin(type, message) {
    console.log(`[WORKER] ${message}`);
    try { await axios.post(LOG_URL, { type, message }); }
    catch (e) { /* Ignore connection errors silently */ }
}

const logWorker = (msg, data = {}) => console.log(`[${new Date().toISOString()}] 👷 [WORKER] ${msg}`, JSON.stringify(data));
const logError = (msg, error) => {
    // Safely extract the message whether it's an object, string, or undefined
    const errorMsg = error?.message || error || "Unknown Error Object";
    console.error(`[${new Date().toISOString()}] ❌ [WORKER ERROR] ${msg}:`, errorMsg);
};

// --- 3. CONFIGURATION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => logWorker("Connected to MongoDB"))
    .catch(err => logError("DB Connection Failed", err));

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// 🚨 DOCKER FIX: Point to the Redis container
const nlpQueue = new Queue('nlp-scanning', process.env.REDIS_URL || 'redis://redis:6379');

nlpQueue.on('error', (err) => logError('Redis Connection Error', err));
nlpQueue.on('failed', (job, err) => logError(`Job ${job.id} failed`, err));
nlpQueue.on('ready', () => logWorker('Ready to accept jobs!'));

logWorker("Compliance Worker is running and waiting for jobs...");

// --- 4. MAIN PROCESSOR ---
nlpQueue.process(async (job) => {
    const { fileId, s3Key, originalName, userId, mode, itemsToRedact } = job.data;

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const tempInput = path.join(tempDir, `in_${job.id}.pdf`);
    const tempOutput = path.join(tempDir, `out_${job.id}.pdf`);

    try {
        logWorker(`Job ${job.id}: Downloading from S3...`);
        const s3Object = await s3.getObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();
        fs.writeFileSync(tempInput, s3Object.Body);

        // ==========================================
        // 🔀 BRANCH A: SELECTIVE MANUAL REDACTION
        // ==========================================
        if (mode === 'selective_redact') {
            logWorker(`Job ${job.id}: Executing SELECTIVE REDACTION for ${originalName}`);

            // Send exact words to the Python Microservice's new manual redaction endpoint
            const nlpEngineUrl = process.env.NLP_ENGINE_URL || 'http://nlp-engine:8000';

            await axios.post(`${nlpEngineUrl}/manual-redact`, {
                input_path: tempInput,
                output_path: tempOutput,
                words_to_redact: itemsToRedact // Array of strings chosen by the user
            }, { timeout: 300000 });

            // Read the newly redacted file
            const redactedBuffer = fs.readFileSync(tempOutput);
            const newS3Key = s3Key.includes('.') ? s3Key.replace(/\.[^/.]+$/, "_redacted$&") : s3Key + '_redacted';

            // Upload the redacted version
            await s3.upload({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: newS3Key,
                Body: redactedBuffer
            }).promise();

            // Delete original unredacted file for security compliance
            await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();

            // Update Database to final state
            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'redacted',
                s3Key: newS3Key,
                redactedS3Key: newS3Key
            });

            await logToAdmin('SUCCESS', `✅ Selective Redaction Complete: ${originalName}`);
            return; // 🛑 EXIT EARLY, JOB DONE.
        }

        // ==========================================
        // 🔀 BRANCH B: INITIAL AI SCAN (Your existing logic)
        // ==========================================
        await File.findByIdAndUpdate(fileId, { complianceStatus: 'scanning' });
        logWorker(`Job ${job.id}: Sending to Python AI Microservice for Initial Scan...`);
        let jsonResult;
        let isSuccess = false;
        let retries = 0;
        const maxRetries = 15; // Wait up to 5 minutes (15 retries * 20 seconds)

        while (!isSuccess && retries < maxRetries) {
            try {
                // 🚨 CLEAN FIX: Ensure we don't double up on the /scan path
                let nlpScanUrl = process.env.NLP_ENGINE_URL || 'http://nlp-engine:8000';
                console.log(`[WORKER] NLP Engine URL: ${nlpScanUrl}`);

                // If the URL doesn't end in /scan, add it. If it does, leave it alone.
                if (!nlpScanUrl.endsWith('/scan')) {
                    nlpScanUrl = `${nlpScanUrl}/scan`;
                }

                console.log(`[WORKER] NLP Engine URL: ${nlpScanUrl}`);

                // Send the request
                const response = await axios.post(nlpScanUrl, {
                    input_path: tempInput,
                    output_path: tempOutput
                }, {
                    timeout: 600000 // 10 minutes processing time once connected
                });

                jsonResult = response.data;
                isSuccess = true; // Break the loop!
                logWorker(`Job ${job.id}: Python Microservice finished successfully`);

            } catch (apiError) {
                // Check if the door is simply closed (Model still loading)
                if (apiError.code === 'ECONNREFUSED') {
                    retries++;
                    logWorker(`Job ${job.id}: AI Engine port closed (Still loading models). Retry ${retries}/${maxRetries} in 20s...`);
                    await new Promise(resolve => setTimeout(resolve, 20000)); // Sleep for 20s
                } else {
                    // It's a REAL error (like a 500 Server Error or 422 Bad Data)
                    const status = apiError.response?.status || "NETWORK_ERROR";
                    const detail = apiError.response?.data?.detail || apiError.message || "Unknown error";

                    logError(`Job ${job.id}: Python Microservice failed (${status})`, detail);
                    throw new Error(`AI Scan Failed: ${detail}`);
                }
            }
        }

        // If it looped 15 times and never connected
        if (!isSuccess) {
            throw new Error("AI Scan Timeout: Python engine never opened its port after 5 minutes.");
        }

        let report = jsonResult.findings || [];
        let riskMeta = jsonResult.meta || { risk_score: 100, classification: "PUBLIC", keywords_found: [] };

        const user = await User.findById(userId);
        if (!user) throw new Error("User not found");

        if (riskMeta.classification === 'INTERNAL' || riskMeta.classification === 'RESTRICTED') {
            logWorker(`Job ${job.id}: ⛔ RESTRICTED CONTENT DETECTED. Executing DLP protocols.`);
            await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key }).promise();
            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'rejected',
                riskScore: riskMeta.risk_score,
                classification: riskMeta.classification,
                riskKeywords: riskMeta.keywords_found,
                rejectionReason: `Policy Violation: Restricted keywords found.`
            });

            const penalty = 20;
            user.trustScore = Math.max(0, user.trustScore - penalty);
            user.violationCount += 1;

            if (user.trustScore === 0) {
                user.isBanned = true;
                user.banExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
            }
            await user.save();
            await logToAdmin('CRITICAL', `⛔ FILE REJECTED! User ${userId} uploaded restricted content.`);
            return;
        }

        const violations = report.length;

        if (violations > 0) {
            logWorker(`Job ${job.id}: ⚠️ PII Detected. Pausing pipeline for user review.`);

            // 1. Map the report to include the default 'pending' action for the UI checklist
            const pendingReport = report.map(item => ({
                ...item,
                action: 'pending'
            }));

            // 2. Update File state to 'awaiting_review'
            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'awaiting_review',
                piiReport: pendingReport,
                riskScore: riskMeta.risk_score,
                classification: riskMeta.classification
            });

            // Note: We DO NOT penalize the user here anymore.
            // We DO NOT upload the redacted file or delete the original yet.
            // The pipeline simply stops and waits for the human.
            await logToAdmin('WARNING', `⚠️ PII Detected in ${originalName}. Holding for user review.`);

        } else {
            // If it's 100% clean, it proceeds as normal
            if (user.trustScore < 100) {
                user.trustScore += 1;
                await user.save();
            }

            await File.findByIdAndUpdate(fileId, {
                complianceStatus: 'clean',
                piiReport: report, // empty array
                riskScore: riskMeta.risk_score,
                classification: riskMeta.classification
            });

            await logToAdmin('SUCCESS', `✅ Scan Clean: ${originalName}`);
        }

    } catch (err) {
        logError(`Job ${job.id}: CRITICAL FAILURE`, err);
        await File.findByIdAndUpdate(fileId, { complianceStatus: 'failed' });
    } finally {
        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    }
});