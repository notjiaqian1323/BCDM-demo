// routes/reports.js - ESM Version
import express from 'express';
const router = express.Router();

// --- Local Imports (🚨 CRITICAL: .js extensions required) ---
import auth from '../middleware/auth.js';
import User from '../models/User.js';
import File from '../models/File.js';
import Block from '../models/Block.js';
import Invitation from '../models/Invitation.js';

// @route   GET /api/reports/predictive-forecasting
// @desc    Calculate storage burn rate and predict capacity exhaustion
router.get('/predictive-forecasting', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        // STRICT ENTERPRISE CHECK
        if (user.package !== 'Enterprise') {
            return res.status(403).json({ msg: "Predictive Forecasting requires the Enterprise plan." });
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const recentUploads = await File.aggregate([
            { $match: { owner: user._id, date: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, totalBytesAdded: { $sum: "$fileSize" } } }
        ]);

        const bytesAdded30Days = recentUploads.length > 0 ? recentUploads[0].totalBytesAdded : 0;
        const dailyBurnRate = bytesAdded30Days / 30;
        const remainingBytes = user.storageLimit - user.storageUsed;

        let daysUntilFull = "Stable";
        let recommendation = "Storage levels are currently stable.";

        if (dailyBurnRate > 0) {
            daysUntilFull = Math.floor(remainingBytes / dailyBurnRate);
            if (daysUntilFull < 14) {
                recommendation = "URGENT: Capacity will be exhausted in less than 2 weeks. Contact support for volume expansion.";
            } else if (daysUntilFull < 60) {
                recommendation = "WARNING: Budget for storage expansion within the next quarter.";
            }
        }

        res.json({
            currentUsageGB: (user.storageUsed / (1024 * 1024 * 1024)).toFixed(2),
            monthlyGrowthRateMB: (bytesAdded30Days / (1024 * 1024)).toFixed(2),
            dailyBurnRateMB: (dailyBurnRate / (1024 * 1024)).toFixed(2),
            estimatedDaysRemaining: daysUntilFull,
            actionableInsight: recommendation
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// @route   GET /api/reports/compliance-csv
// @desc    Downloadable Data Provenance Audit with Date Range Filter
router.get('/compliance-csv', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        // STRICT ENTERPRISE CHECK
        if (user.package !== 'Enterprise') {
            return res.status(403).json({ msg: "Compliance Auditing requires the Enterprise plan." });
        }

        // Build the query with Date Filtering
        let query = { owner: user._id };

        if (req.query.startDate && req.query.endDate) {
            query.date = {
                $gte: new Date(req.query.startDate),
                // Set to end of the day to ensure full day coverage
                $lte: new Date(new Date(req.query.endDate).setHours(23, 59, 59, 999))
            };
        }

        const files = await File.find(query).populate('uploadedBy', 'email').sort({ date: -1 });

        let csv = "File Name,Size (Bytes),Uploader,Workspace ID,Upload Date,Blockchain Tx Hash,File Hash (Integrity)\n";

        for (let file of files) {
            const block = await Block.findOne({ fileId: file._id.toString() });
            const wsName = file.workspaceId ? file.workspaceId : "Personal Drive";
            const uploader = file.uploadedBy ? file.uploadedBy.email : "Unknown";
            const txHash = block ? block.ethTxHash : "Pending/Failed";
            const fileHash = block ? block.fileHash : "N/A";

            // Escape quotes in filenames to prevent breaking CSV format
            const safeName = `"${file.fileName.replace(/"/g, '""')}"`;

            csv += `${safeName},${file.fileSize},${uploader},${wsName},${file.date.toISOString()},${txHash},${fileHash}\n`;
        }

        res.header('Content-Type', 'text/csv');
        res.attachment(`BCDS_Audit_${req.query.startDate || 'All'}_to_${req.query.endDate || 'All'}.csv`);
        return res.send(csv);

    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// @route   GET /api/reports/access-matrix
// @desc    Get a Zero-Trust Access & Exposure Matrix for workspace owners
router.get('/access-matrix', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        // STRICT ENTERPRISE CHECK
        if (user.package !== 'Enterprise') {
            return res.status(403).json({ msg: "Access Matrix requires the Enterprise plan." });
        }

        let matrix = [];

        // Iterate through every workspace this user owns
        for (let ws of user.workspacesCreated) {
            // 1. Find users who have this workspace in their joined list
            const activeUsers = await User.find({ workspacesJoined: ws._id.toString() }, 'username email');

            // 2. Find pending invitations for this workspace
            const pendingInvites = await Invitation.find({ workspaceId: ws._id.toString(), status: 'pending' });

            matrix.push({
                workspaceName: ws.name,
                workspaceId: ws._id,
                activeCollaborators: activeUsers.map(u => ({ username: u.username, email: u.email })),
                pendingInvitations: pendingInvites.map(inv => ({ email: inv.inviteeEmail, date: inv.date }))
            });
        }

        res.json({
            totalWorkspaces: user.workspacesCreated.length,
            matrix: matrix
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

export default router; //