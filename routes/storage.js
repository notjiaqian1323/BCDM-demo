const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const File = require('../models/File');
const Activity = require('../models/Activity');
const multer = require('multer');
const AWS = require('aws-sdk');
const Queue = require('bull');
const { addLog } = require('../utils/logger');
const nlpQueue = new Queue('nlp-scanning', process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});
const upload = multer({ storage: multer.memoryStorage() });

// --- HELPER FUNCTION LOGS ---
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

// ==========================================
// ROUTES
// ==========================================

router.post('/upload', [auth, upload.single('file')], async (req, res) => {
    console.log(`\n📤 [STORAGE API] POST /upload started by user ${req.user.id}`);
    if (!req.file) {
        return res.status(400).json({ msg: "No file provided" });
    }
    // 🔍 DEBUG: See what Multer actually caught
    console.log(`[DEBUG] req.body:`, req.body);

    const driveId = req.query.drive || 'personal';

    // 🧠 NEW: Check if the frontend checkbox was ticked
    const requiresNlp = req.body.scanPii === 'true';
    console.log(`[DEBUG] Requires NLP? ${requiresNlp}`);

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
        console.log(`[STORAGE API] Uploading to AWS S3... Key: ${s3Key}`);

        // (Side note: Your friend's button says "Encrypt", but right now this is uploading raw.
        // We can add actual encryption here later if needed!)
        const s3Result = await s3.upload({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3Key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        }).promise();

        console.log(`[STORAGE API] AWS Upload successful. Saving to MongoDB...`);
        const newFile = new File({
            owner: targetOwner._id,
            uploadedBy: req.user.id,
            workspaceId: driveId === 'personal' ? null : driveId,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            s3Url: s3Result.Location,
            s3Key: s3Result.Key,
            // 🧠 NEW: Set initial compliance status based on checkbox
            complianceStatus: requiresNlp ? 'scanning' : 'clean'
        });

        await newFile.save();

        targetOwner.storageUsed += req.file.size;
        await targetOwner.save();

        // 📊 NEW: Log the basic upload to the Admin Dashboard
        await addLog('UPLOAD', `User uploaded "${req.file.originalname}" to ${locationName}`, req);

        // 🧠 NEW: Trigger the Python Worker if checkbox was ticked
        if (requiresNlp) {
            console.log(`[STORAGE API] 🛡️ NLP Scan requested! Queuing job...`);
            await nlpQueue.add({
                fileId: newFile._id,
                s3Key: newFile.s3Key,
                userId: req.user.id,
                originalName: req.file.originalname
            });

            // Log to Admin Dashboard that AI is working
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
        // 📊 NEW: Log the error to the Admin Dashboard
        await addLog('ERROR', `Upload failed for ${req.file?.originalname || 'unknown file'}`, req);
        return res.status(500).json({ msg: err.message || "Server Error during upload" });
    }
});

router.get('/files', auth, async (req, res) => {
    const driveId = req.query.drive || 'personal';
    console.log(`\n📂 [STORAGE API] GET /files requested for drive: ${driveId} by user: ${req.user.id}`);

    try {
        const targetOwner = await getTargetDrive(req);

        const filter = {
            owner: targetOwner._id,
            workspaceId: driveId === 'personal' ? null : driveId
        };

        console.log(`[STORAGE API] Querying MongoDB for files... Filter:`, filter);
        const files = await File.find(filter).populate('uploadedBy', 'username').sort({ date: -1 });

        console.log(`✅ [STORAGE API] Success: Found ${files.length} files.`);
        res.json(files);
    } catch (err) {
        // THE CRITICAL FIX: Actually logging the error!
        console.error("💥 [STORAGE API] CRITICAL GET /files ERROR:", err);
        res.status(500).send('Server Error');
    }
});

router.delete('/files/:id', auth, async (req, res) => {
    console.log(`\n🗑️ [STORAGE API] DELETE /files/${req.params.id} requested by user: ${req.user.id}`);
    try {
        const file = await File.findById(req.params.id);
        if (!file) {
            console.warn(`⚠️ [STORAGE API] Delete aborted: File not found in DB.`);
            return res.status(404).json({ msg: "File not found" });
        }

        const targetOwner = await User.findById(file.owner);
        const isWorkspaceOwner = targetOwner._id.toString() === req.user.id;
        const isFileUploader = file.uploadedBy.toString() === req.user.id;

        console.log(`[STORAGE API] Delete Permissions -> isWorkspaceOwner: ${isWorkspaceOwner}, isFileUploader: ${isFileUploader}`);

        if (!isWorkspaceOwner && !isFileUploader) {
            console.warn(`🚫 [STORAGE API] Delete rejected: Unauthorized.`);
            return res.status(403).json({ msg: "Unauthorized: Only the workspace owner or the uploader can delete this file." });
        }

        console.log(`[STORAGE API] Deleting object from AWS S3... Key: ${file.s3Key}`);
        await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key }).promise();

        console.log(`[STORAGE API] Removing file record from MongoDB...`);
        await File.findByIdAndDelete(req.params.id);

        targetOwner.storageUsed = Math.max(0, targetOwner.storageUsed - file.fileSize);
        await targetOwner.save();
        console.log(`✅ [STORAGE API] Delete sequence complete.`);

        if (typeof Activity !== 'undefined') {
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
        }

        res.json({ msg: "File deleted and storage updated" });
    } catch (err) {
        console.error("💥 [STORAGE API] CRITICAL DELETE ERROR:", err);
        res.status(500).json({ msg: "Server Error: Could not delete file." });
    }
});

router.get('/download/:id', auth, async (req, res) => {
    console.log(`\n⬇️ [STORAGE API] GET /download/${req.params.id} requested by user: ${req.user.id}`);
    try {
        const file = await File.findById(req.params.id);
        if (!file) {
            console.warn(`⚠️ [STORAGE API] Download aborted: File not found in DB.`);
            return res.status(404).json({ msg: "File not found" });
        }

        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: file.s3Key
        };

        console.log(`✅ [STORAGE API] Piping file stream from AWS S3 to client... Key: ${file.s3Key}`);
        const fileStream = s3.getObject(params).createReadStream();
        res.attachment(file.fileName);
        fileStream.pipe(res);
    } catch (err) {
        console.error("💥 [STORAGE API] CRITICAL DOWNLOAD ERROR:", err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;