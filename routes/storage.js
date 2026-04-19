import express from 'express';
import multer from 'multer';
import AWS from 'aws-sdk';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Queue from 'bull';

// --- Local Imports (🚨 CRITICAL: .js extensions required) ---
import auth from '../middleware/auth.js';
import admin from '../middleware/admin.js';
import User from '../models/User.js';
import File from '../models/File.js';
import Activity from '../models/Activity.js';
import { logToBlockchain } from './blockchain.js';
import { addLog } from '../utils/logger.js';
import BlockModel from '../models/Block.js';

// --- ESM __dirname Shim ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
// --- AFTER (THE FIX) ---
// 🚨 DOCKER FIX: Point to the 'redis' container service
const nlpQueue = new Queue('nlp-scanning', process.env.REDIS_URL || 'redis://redis:6379');

// --- BLOCKCHAIN TRAFFIC CONTROLLER (MUTEX) ---
// Prevents "Nonce too low" errors during batch uploads by forcing linear execution
class Mutex {
    constructor() { this.queue = []; this.locked = false; }
    async lock() {
        return new Promise(resolve => {
            if (!this.locked) { this.locked = true; resolve(); }
            else { this.queue.push(resolve); }
        });
    }
    unlock() {
        if (this.queue.length > 0) { const next = this.queue.shift(); next(); }
        else { this.locked = false; }
    }
}
const blockchainLock = new Mutex(); // Instantiate the global lock

// Connect to Ganache
// 🚨 DOCKER FIX: Point to the Host machine, and ensure port is 8545
// Connect to Ganache
const RPC_URL = process.env.RPC_URL || "http://host.docker.internal:8545";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// 🚨 FIX: Strip hidden Windows characters from the address
const contractAddress = process.env.CONTRACT_ADDRESS?.trim();

if (!contractAddress) {
    console.error("❌ [STORAGE API] CRITICAL: CONTRACT_ADDRESS is missing from environment variables!");
}

// Load ABI using shimmed path
const contractABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../contractABI.json'), 'utf8'));

// Initialize with the cleaned address
const aclContract = new ethers.Contract(contractAddress, contractABI, provider);

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const ALLOWED_TYPES = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/jpeg': 'jpg',
    'image/png': 'png'
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        // 🔍 Check if the MIME type is in our allowed list
        if (ALLOWED_TYPES[file.mimetype]) {
            cb(null, true); // Accept the file
        } else {
            // Reject the file with a custom error
            cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF, DOCX, and Images are allowed.`), false);
        }
    }
});

async function getTargetDrive(req) {
    const driveId = req.query.drive || 'personal';
    console.log(`🔍 [STORAGE API] getTargetDrive: Resolving drive access for ID: ${driveId}`);

    const requestingUser = await User.findById(req.user.id);
    if (!requestingUser) {
        console.error(`❌ [STORAGE API] getTargetDrive: Requesting user (ID: ${req.user.id}) not found in DB!`);
        throw { status: 404, msg: "User not found." };
    }

    if (driveId === 'personal') {
        console.log(`✅ [STORAGE API] getTargetDrive: Access granted to Personal Drive.`);
        return requestingUser;
    }

    console.log(`[STORAGE API] getTargetDrive: Checking if user owns workspace ${driveId}...`);
    const owned = requestingUser.workspacesCreated ? requestingUser.workspacesCreated.id(driveId) : null;
    if (owned) {
        console.log(`✅ [STORAGE API] getTargetDrive: Access granted. User is the owner of workspace.`);
        return requestingUser;
    }

    console.log(`[STORAGE API] getTargetDrive: Checking if user is joined to workspace ${driveId}...`);
    const isJoined = requestingUser.workspacesJoined ? requestingUser.workspacesJoined.includes(driveId) : false;
    if (isJoined) {
        console.log(`[STORAGE API] getTargetDrive: User is a guest. Locating workspace owner...`);
        const owner = await User.findOne({ "workspacesCreated._id": driveId });
        if (!owner) {
            console.error(`❌ [STORAGE API] getTargetDrive: Workspace ${driveId} exists in user's joined list, but the owner cannot be found in the DB!`);
            throw { status: 404, msg: "Workspace no longer exists." };
        }
        console.log(`✅ [STORAGE API] getTargetDrive: Access granted. Guest accessing owner's storage.`);
        return owner;
    }

    console.error(`🚫 [STORAGE API] getTargetDrive: UNAUTHORIZED. User is neither owner nor guest.`);
    throw { status: 403, msg: "Unauthorized: You do not have access to this folder." };
}

// @route   POST /api/storage/upload
// @route   POST /api/storage/upload
router.post('/upload', auth, async (req, res) => {
    upload.single('file')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ msg: `Upload Error: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ msg: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ msg: "No file provided or file type rejected." });
        }

        const driveId = req.query.drive || 'personal';
        const requiresNlp = req.body.scanPii === 'true';

        try {
            const targetOwner = await getTargetDrive(req);

            if (targetOwner.storageUsed + req.file.size > targetOwner.storageLimit) {
                return res.status(400).json({ msg: "Upload failed: Not enough storage space." });
            }

            let folderPath = 'personal';
            let locationName = "Personal Drive";

            if (driveId !== 'personal') {
                const workspace = targetOwner.workspacesCreated.id(driveId);
                folderPath = workspace ? workspace.name : 'UnknownWorkspace';
                locationName = workspace ? `workspace "${workspace.name}"` : "a shared workspace";
            }

            const s3Key = `${targetOwner.email}/${folderPath}/${Date.now()}-${req.file.originalname}`;

            // ☁️ S3 Handles concurrent uploads perfectly fine
            const s3Result = await s3.upload({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: s3Key,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            }).promise();

            const newFile = new File({
                owner: targetOwner._id,
                uploadedBy: req.user.id,
                workspaceId: driveId === 'personal' ? null : driveId,
                fileName: req.file.originalname,
                fileSize: req.file.size,
                s3Url: s3Result.Location,
                s3Key: s3Result.Key,
                complianceStatus: requiresNlp ? 'scanning' : 'clean',
                isDeleted: false
            });

            await newFile.save();

            // 🛡️ 1. THE BLOCKCHAIN LOCK
            // We wait our turn in line. If another file is anchoring, this pauses.
            await blockchainLock.lock();
            try {
                const minedBlock = await logToBlockchain(newFile._id.toString());
                newFile.blockchainIndex = minedBlock.index;
                newFile.ethTxHash = minedBlock.ethTxHash;
                await newFile.save();
                console.log(`⛓️ [BATCH] File ${newFile.fileName} permanently linked to Block #${minedBlock.index}`);
            } catch (chainErr) {
                console.error("Blockchain logging failed:", chainErr.message);
            } finally {
                // VERY IMPORTANT: Always release the lock so the next file can go!
                blockchainLock.unlock();
            }

            // 🛡️ 2. ATOMIC DATABASE UPDATE
            // We replace "targetOwner.save()" with MongoDB's $inc operator.
            // This prevents "Race Conditions" and ensures all concurrent file sizes are added properly.
            await User.findByIdAndUpdate(targetOwner._id, {
                $inc: { storageUsed: req.file.size }
            });

            await addLog('UPLOAD', `User uploaded "${req.file.originalname}" to ${locationName}`, req);

            // 🧠 3. NLP QUEUE (You already have this perfectly set up!)
            // Because you used nlpQueue.add(), BullMQ will handle Gemini rate limits automatically!
            if (requiresNlp) {
                await nlpQueue.add({
                    fileId: newFile._id,
                    s3Key: newFile.s3Key,
                    userId: req.user.id,
                    originalName: req.file.originalname
                });
                await addLog('WORKER', `NLP Scan queued for file: ${req.file.originalname}`, req);
            }

            try {
                await new Activity({
                    userId: req.user.id,
                    type: 'FILE_UPLOADED',
                    details: `Uploaded "${req.file.originalname}" to ${locationName}`
                }).save();
            } catch (logErr) {
                console.error("⚠️ [STORAGE API] Activity logging failed:", logErr.message);
            }

            return res.status(200).json({ msg: "Uploaded!", file: newFile });

        } catch (err) {
            console.error("💥 [STORAGE API] CRITICAL UPLOAD ERROR:", err);
            await addLog('ERROR', `Upload failed for ${req.file?.originalname || 'unknown file'}`, req);
            return res.status(500).json({ msg: err.message || "Server Error during upload" });
        }
    });
});

// @route   GET /api/storage/files
router.get('/files', auth, async (req, res) => {
    const driveId = req.query.drive || 'personal';
    console.log(`\n📂 [STORAGE API] GET /files requested for drive: ${driveId} by user: ${req.user.id}`);

    try {
        const targetOwner = await getTargetDrive(req);
        // 🛡️ THE FIX: Add isDeleted: false to the filter
        const filter = {
            owner: targetOwner._id,
            workspaceId: driveId === 'personal' ? null : driveId,
            isDeleted: false // 👈 This hides the "Blockchain-only" records
        };

        console.log(`[STORAGE API] Querying MongoDB for files... Filter:`, filter);
        const files = await File.find(filter).populate('uploadedBy', 'username').sort({ date: -1 });

        console.log(`✅ [STORAGE API] Success: Found ${files.length} active files.`);
        res.json(files);
    } catch (err) {
        console.error("💥 [STORAGE API] CRITICAL GET /files ERROR:", err);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/storage/files/:id
router.delete('/files/:id', auth, async (req, res) => {
    console.log(`\n🗑️ [STORAGE API] DELETE /files/${req.params.id} requested by user: ${req.user.id}`);
    try {
        // 1. Find the file (ensure we don't try to delete an already deleted file)
        const file = await File.findOne({ _id: req.params.id, isDeleted: false });

        if (!file) {
            return res.status(404).json({ msg: "File not found or already deleted." });
        }

        const targetOwner = await User.findById(file.owner);
        const isWorkspaceOwner = targetOwner._id.toString() === req.user.id;
        const isFileUploader = file.uploadedBy.toString() === req.user.id;

        if (!isWorkspaceOwner && !isFileUploader) {
            return res.status(403).json({ msg: "Unauthorized." });
        }

        // 🛡️ 2. THE SOFT DELETE LOGIC
        // We delete from S3 to stop charging you money for storage
        try {
            await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key }).promise();
            console.log(`🗑️ S3 object deleted for file: ${file.fileName}`);
        } catch (s3Err) {
            console.error("⚠️ S3 deletion failed (perhaps already gone?):", s3Err.message);
        }

        // We DO NOT call File.findByIdAndDelete().
        // Instead, we mark it as deleted but keep the metadata + blockchain receipt.
        file.isDeleted = true;
        file.s3Key = `DELETED_${Date.now()}_${file.s3Key}`; // Clean the key so name is available
        await file.save();

        // 3. Update storage quota
        const sizeToRemove = file.fileSize || 0; // Fallback to 0 if missing
        targetOwner.storageUsed = Math.max(0, (targetOwner.storageUsed || 0) - sizeToRemove);
        await targetOwner.save();

        try {
            const workspace = file.workspaceId ? targetOwner.workspacesCreated.id(file.workspaceId) : null;
            const location = workspace ? `from workspace "${workspace.name}"` : 'from personal drive';

            await new Activity({
                userId: req.user.id,
                type: 'FILE_DELETED',
                details: `Deleted "${file.fileName}" ${location}`
            }).save();
        } catch (logErr) {
            console.error("⚠️ [STORAGE API] Activity logging failed (non-fatal):", logErr.message);
        }

        res.json({ msg: "File removed from drive. Blockchain record preserved for audit." });
    } catch (err) {
        console.error("💥 [STORAGE API] CRITICAL DELETE ERROR:", err);
        res.status(500).json({ msg: "Server Error: Could not delete file." });
    }
});

// @route   GET /api/storage/download/:id
router.get('/download/:id', auth, async (req, res) => {
    console.log(`\n⬇️ [STORAGE API] GET /download/${req.params.id} requested by user: ${req.user.id}`);

    try {
        const file = await File.findById(req.params.id);
        if (!file) return res.status(404).json({ msg: "File not found" });

        // 🛡️ BLOCKCHAIN VERIFICATION
        console.log(`[DOWNLOAD] Verifying Blockchain Anchor: ${file.ethTxHash}`);

        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");

        // 🚨 DEBUG: Check if Ganache is actually alive before awaiting the transaction
        try {
            await Promise.race([
                provider.getNetwork(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 3000))
            ]);
        } catch (rpcErr) {
            console.error("❌ RPC Connection Failed. Is Ganache running?");
            return res.status(503).json({ msg: "Blockchain Network Offline. Download blocked for security." });
        }

        const tx = await provider.getTransaction(file.ethTxHash);
        const localBlock = await BlockModel.findOne({ index: file.blockchainIndex });
        const onChainHash = tx ? tx.data.replace("0x", "") : null;

        if (!onChainHash || !localBlock || onChainHash !== localBlock.hash) {
            console.error("🚨 INTEGRITY FAILURE: Download Blocked.");
            return res.status(403).json({
                msg: "Security Block: File integrity could not be verified against the Ledger."
            });
        }

        // 🔗 WORKSPACE ACCESS CHECK (SMART CONTRACT)
        if (file.workspaceId) {
            // 1. Force IDs to lowercase strings to prevent hexadecimal/type mismatches
            const cleanWorkspaceId = file.workspaceId.toString().toLowerCase();
            const cleanUserId = req.user.id.toString().toLowerCase();

            console.log(`[DEBUG] CONTRACT INPUT -> Workspace: ${cleanWorkspaceId} | User: ${cleanUserId}`);

            try {
                const hasAccess = await aclContract.checkAccess(
                    cleanWorkspaceId,
                    cleanUserId
                );

                console.log(`[DEBUG] CONTRACT RESPONSE -> Access Granted: ${hasAccess}`);

                if (!hasAccess) {
                    console.warn("🚫 Access Denied by Smart Contract logic.");
                    return res.status(403).json({
                        msg: "Security Block: Your ID is not authorized for this Workspace in the Blockchain Ledger."
                    });
                }
            } catch (contractErr) {
                console.error("💥 Smart Contract Execution Error:", contractErr.message);
                return res.status(500).json({ msg: "Blockchain Authorization Error." });
            }
        }

        // ☁️ S3 STREAMING
        console.log(`[DOWNLOAD] Integrity Verified. Fetching from S3: ${file.s3Key}`);
        const params = { Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key };

        // Check if file exists in S3 before starting stream to prevent hanging
        try {
            await s3.headObject(params).promise();
        } catch (s3Err) {
            console.error("❌ S3 File Missing:", s3Err.message);
            return res.status(404).json({ msg: "Physical file missing from cloud storage." });
        }

        const fileStream = s3.getObject(params).createReadStream();

        // Handle stream errors before piping
        fileStream.on('error', (err) => {
            console.error("💥 Stream Error:", err);
            if (!res.headersSent) {
                res.status(500).json({ msg: "Error streaming file from S3" });
            }
        });

        res.attachment(file.fileName);
        fileStream.pipe(res);

    } catch (err) {
        console.error("💥 [STORAGE API] CRITICAL DOWNLOAD ERROR:", err);
        // Important: Only send error if we haven't started sending the file yet
        if (!res.headersSent) {
            res.status(500).json({ msg: "Server Error: " + err.message });
        }
    }
});

// @route   GET /api/storage/verify/:id
router.get('/verify/:id', auth, async (req, res) => {
    console.log(`\n🔍 [VERIFY API] Starting integrity check for File ID: ${req.params.id}`);

    try {
        // 1. Fetch File Metadata from MongoDB
        const file = await File.findById(req.params.id);
        if (!file) {
            console.error(`❌ [VERIFY API] File not found in MongoDB.`);
            return res.status(404).json({ msg: "No record found for this file." });
        }
        if (!file.ethTxHash) {
            console.warn(`⚠️ [VERIFY API] File exists but has no Ethereum Transaction Hash.`);
            return res.status(404).json({ msg: "No blockchain record found for this file." });
        }

        console.log(`[VERIFY API] File Found: "${file.fileName}"`);
        console.log(`[VERIFY API] Target TxID: ${file.ethTxHash}`);

        // 2. Fetch Transaction from Ganache
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
        console.log(`[VERIFY API] Connecting to RPC: ${provider._getConnection().url}`);

        const tx = await provider.getTransaction(file.ethTxHash);
        if (!tx) {
            console.error(`❌ [VERIFY API] Transaction not found on the Blockchain!`);
            return res.status(404).json({ msg: "Transaction record missing from Ethereum." });
        }

        // 3. Extract and Clean On-Chain Data
        const onChainHash = tx.data.replace("0x", "");
        console.log(`[VERIFY API] On-Chain Data Extracted: ${onChainHash}`);

        // 4. Fetch the Local Block for Comparison
        const localBlock = await BlockModel.findOne({ index: file.blockchainIndex });
        if (!localBlock) {
            console.error(`❌ [VERIFY API] Block record #${file.blockchainIndex} missing from MongoDB Block collection.`);
            return res.status(404).json({ msg: "Local block metadata missing." });
        }

        console.log(`[VERIFY API] Local Block Hash:       ${localBlock.hash}`);

        // 5. Final Comparison
        const isAuthentic = onChainHash === localBlock.hash;

        if (isAuthentic) {
            console.log(`✅ [VERIFY API] SUCCESS: On-chain and Local hashes match perfectly.`);
        } else {
            console.error(`🚨 [VERIFY API] TAMPER DETECTED: Hashes do not match!`);
            console.error(`   - On-Chain: ${onChainHash}`);
            console.error(`   - Local:    ${localBlock.hash}`);
        }

        res.json({
            authentic: isAuthentic,
            details: {
                onChainHash: onChainHash,
                localHash: localBlock.hash,
                txid: file.ethTxHash,
                blockIndex: file.blockchainIndex,
                timestamp: localBlock.timestamp
            }
        });

    } catch (err) {
        console.error("💥 [VERIFY API] CRITICAL ERROR during verification:", err.message);
        res.status(500).json({ msg: "Integrity check failed: " + err.message });
    }
});

// @route   GET /api/storage/audit
// @desc    Perform a deep-scan cross-reference between MongoDB and Ethereum
// @access  Private (Admin / User)
router.get('/audit', [auth, admin], async (req, res) => {
    console.log(`\n🕵️‍♂️ [AUDIT API] System-Wide Integrity Audit initiated by User: ${req.user.id}`);

    try {
        let query = { isDeleted: false };

        if (req.user.role !== 'admin') {
            query.owner = req.user.id;
        }

        // Using .populate ensures we have the username for the anomaly report
        const files = await File.find(query)
            .populate('owner', 'username')
            .exec(); // .exec() returns a real Promise, which IDEs prefer

        console.log(`[AUDIT API] Found ${files.length} records for verification.`);

        // Initialize the report structure expected by the frontend
        let report = {
            totalFiles: files.length,
            verifiedCount: 0,
            tamperedCount: 0,
            anomalies: [],
            scanTime: new Date().toISOString()
        };

        if (files.length === 0) {
            console.log(`[AUDIT API] No active files found to scan.`);
            return res.json(report);
        }

        // 2. Connect to the Blockchain
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");

        // 3. The Verification Loop
        for (let file of files) {
            // If the file doesn't have a transaction hash yet, we can't verify it
            if (!file.ethTxHash) {
                console.warn(`[AUDIT API] Skipping file ${file.fileName} - No Blockchain Anchor.`);
                continue;
            }

            try {
                // Fetch from Ganache
                const tx = await provider.getTransaction(file.ethTxHash);
                // Fetch the ledger receipt from MongoDB
                const localBlock = await BlockModel.findOne({ index: file.blockchainIndex });

                // Clean the '0x' prefix from the Ethereum data payload
                const onChainHash = tx ? tx.data.replace("0x", "") : null;

                // 🛡️ The Ultimate Integrity Check
                if (onChainHash && localBlock && onChainHash === localBlock.hash) {
                    report.verifiedCount++;
                } else {
                    // Record the exact reason for the failure
                    let issueReason = "Hash mismatch (Data Altered)";
                    if (!localBlock) issueReason = "Local block metadata missing (DB Sabotage)";
                    if (!tx) issueReason = "Ethereum transaction missing (Network sync error)";

                    report.tamperedCount++;
                    report.anomalies.push({
                        fileId: file._id,
                        fileName: file.fileName,
                        issue: issueReason
                    });
                }
            } catch (verifyErr) {
                console.error(`⚠️ Error verifying file ${file.fileName}:`, verifyErr.message);
                report.tamperedCount++;
                report.anomalies.push({
                    fileId: file._id,
                    fileName: file.fileName,
                    owner: file.owner?.username || "Unknown", // Add this!
                    issue: "Connection error or corrupt transaction data"
                });
            }
        }

        console.log(`✅ [AUDIT API] Audit Complete. Verified: ${report.verifiedCount}, Tampered: ${report.tamperedCount}`);
        res.json(report);

    } catch (err) {
        console.error("💥 [AUDIT API] CRITICAL ERROR:", err);
        res.status(500).json({ msg: "System Audit Failed: " + err.message });
    }
});

// @route   POST /api/storage/nlp-commit/:id
// @desc    Apply user decisions to pending AI findings
router.post('/nlp-commit/:id', auth, async (req, res) => {
    try {
        const fileId = req.params.id;
        const { decisions } = req.body;
        // Expected payload: { decisions: [ { text: "user@email.com", action: "redact" }, { text: "+60123456789", action: "keep" } ] }

        const file = await File.findById(fileId);
        if (!file) {
            return res.status(404).json({ msg: "File not found" });
        }

        // 🛡️ Security Check: Ensure the user owns this file
        if (file.owner.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ msg: "Not authorized to modify this file." });
        }

        if (file.complianceStatus !== 'awaiting_review') {
            return res.status(400).json({ msg: "File is not awaiting review." });
        }

        // 1. Update the database with the user's specific decisions
        let itemsToRedact = [];

        file.piiReport = file.piiReport.map(item => {
            // Find the user's decision for this specific finding
            const userDecision = decisions.find(d => d.text === item.text);

            if (userDecision) {
                item.action = userDecision.action;
                if (userDecision.action === 'redact') {
                    itemsToRedact.push(item.text);
                }
            }
            return item;
        });

        // 2. SCENARIO A: The user chose to "Keep" everything.
        if (itemsToRedact.length === 0) {
            file.complianceStatus = 'clean';
            await file.save();

            // Log the override
            await addLog('SUCCESS', `User manually approved all AI findings for: ${file.fileName}`, req);

            return res.status(200).json({
                msg: "All findings approved. File marked as clean.",
                status: 'clean'
            });
        }

        // 3. SCENARIO B: There are items that need to be redacted.
        // We set status back to scanning, save the DB, and send it to the worker.
        file.complianceStatus = 'scanning';
        await file.save();

        // 🚀 We put it back in your existing BullMQ Queue, but with a new 'mode' flag!
        await nlpQueue.add({
            fileId: file._id,
            s3Key: file.s3Key,
            userId: req.user.id,
            originalName: file.fileName,
            mode: 'selective_redact', // Tells the worker to skip scanning and just redact
            itemsToRedact: itemsToRedact // Pass the exact strings to block out
        });

        await addLog('WORKER', `Selective redaction queued for: ${file.fileName}`, req);

        res.status(200).json({
            msg: "Redaction choices saved. Processing final document...",
            status: 'scanning'
        });

    } catch (err) {
        console.error("💥 [NLP COMMIT ERROR]:", err);
        res.status(500).json({ msg: "Server error during NLP commit." });
    }
});

export default router;