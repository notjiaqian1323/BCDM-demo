import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { ethers } from 'ethers';
import AWS from 'aws-sdk';
import Stripe from 'stripe';

// Models & Middleware (🚨 Extensions required)
import auth from '../middleware/auth.js';
import User from '../models/User.js';
import FileModel from '../models/File.js';
import Invitation from '../models/Invitation.js';
import Activity from '../models/Activity.js';

// ESM __dirname Shim
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// @route   GET /api/subscription/status
router.get('/status', auth, async (req, res) => {

    try {
        const user = await User.findById(req.user.id);

        // 🛡️ NEW: Catch the Ghost Token before it touches user.email
        if (!user) {
            return res.status(404).json({ msg: "User not found. Token may be invalid or expired." });
        }

        const userEmail = user.email.toLowerCase().trim();

        // 1. Fetch Shared Workspaces
        const sharedOwners = await User.find({
            "workspacesCreated._id": { $in: user.workspacesJoined }
        }, 'username workspacesCreated');

        const sharedWorkspaces = [];
        sharedOwners.forEach(owner => {
            owner.workspacesCreated.forEach(folder => {
                if (user.workspacesJoined.includes(folder._id.toString())) {
                    sharedWorkspaces.push({
                        _id: folder._id,
                        name: folder.name,
                        username: owner.username
                    });
                }
            });
        });

        // 2. Fetch Pending Invitations
        const [inboxRaw, pendingSent] = await Promise.all([
            Invitation.find({ inviteeEmail: userEmail, status: 'pending' })
                .populate('inviter', 'username workspacesCreated'),
            Invitation.find({ inviter: req.user.id, status: 'pending' })
        ]);

        const inbox = inboxRaw.map(inv => ({
            ...inv._doc,
            workspaceName: inv.inviter.workspacesCreated.id(inv.workspaceId)?.name || "Shared Drive"
        }));

        // 3. FETCH PERSISTENT ACTIVITY FEED
        const activityFeedRaw = await Activity.find({
            $or: [
                { userId: req.user.id }
            ]
        })
            .sort({ date: -1 })
            .limit(10);

        const activityFeed = activityFeedRaw.map(act => {
            let displayUser = user.username;

            if (act.type === 'INVITE_ACCEPTED') {
                displayUser = user.username;
            }

            return {
                type: act.type,
                name: act.details,
                date: act.date,
                user: "You"
            };
        });

        res.json({
            package: user.package,
            limit: user.storageLimit,
            used: user.storageUsed,
            userEmail: user.email,
            username: user.username,
            subscriptionEnd: user.subscriptionEnd,
            workspaces: sharedWorkspaces,
            workspacesCreated: user.workspacesCreated,
            inbox,
            pendingSentInvites: pendingSent,
            activityFeed
        });
    } catch (err) {
        console.error("💥 Status Route Error:", err.message);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
});

// @route   POST /api/subscription/workspaces
router.post('/workspaces', auth, async (req, res) => {
    const { name, allocateGB } = req.body;
    try {
        const user = await User.findById(req.user.id);

        if (user.package === 'Basic') {
            return res.status(403).json({ msg: "Upgrade required to create workspaces." });
        }

        const requestedBytes = (parseInt(allocateGB) || 1) * 1024 * 1024 * 1024;

        const alreadyAllocated = user.workspacesCreated.reduce((acc, ws) => acc + ws.allocatedBytes, 0);
        const remainingQuota = user.storageLimit - alreadyAllocated;

        if (requestedBytes > remainingQuota) {
            const remainingGB = (remainingQuota / (1024 * 1024 * 1024)).toFixed(2);
            return res.status(400).json({
                msg: `Insufficient quota. You only have ${remainingGB} GB remaining.`
            });
        }

        const workspaceName = name.trim();
        if (user.workspacesCreated.some(ws => ws.name.toLowerCase() === workspaceName.toLowerCase())) {
            return res.status(400).json({ msg: `Workspace "${workspaceName}" already exists.` });
        }

        await s3.putObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${user.email}/${workspaceName}/`
        }).promise();

        user.workspacesCreated.push({
            name: workspaceName,
            allocatedBytes: requestedBytes
        });

        await user.save();

        await new Activity({
            userId: req.user.id,
            type: 'WORKSPACE_CREATED',
            details: `Created workspace "${workspaceName}" with ${allocateGB}GB`
        }).save();

        res.json({ msg: "Workspace Created Successfully!" });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});

// @route   POST /api/subscription/share
router.post('/share', auth, async (req, res) => {
    const { emailToShare, workspaceId } = req.body;
    try {
        const user = await User.findById(req.user.id);
        const inviteeEmail = emailToShare.toLowerCase().trim();

        if (inviteeEmail === user.email.toLowerCase()) {
            return res.status(400).json({
                msg: "You cannot invite yourself to your own workspace."
            });
        }

        const existingInvite = await Invitation.findOne({
            inviteeEmail,
            workspaceId,
            status: 'pending'
        });

        if (existingInvite) {
            return res.status(400).json({ msg: "A pending invitation already exists for this user." });
        }

        const newInvite = new Invitation({
            inviter: req.user.id,
            inviteeEmail,
            workspaceId
        });

        await newInvite.save();
        res.json({ msg: "Invite sent successfully!" });

    } catch (err) {
        console.error("Invite Error:", err);
        res.status(500).send('Server Error');
    }
});

// @route POST /api/subscription/accept-invite/:id
router.post('/accept-invite/:id', auth, async (req, res) => {
    try {
        const invite = await Invitation.findById(req.params.id);
        const invitee = await User.findById(req.user.id);
        const inviter = await User.findById(invite.inviter);
        const workspace = inviter.workspacesCreated.id(invite.workspaceId);

        if (!invitee.workspacesJoined.includes(invite.workspaceId)) {
            invitee.workspacesJoined.push(invite.workspaceId);
        }
        if (!inviter.sharedUsers.includes(invitee.email)) {
            inviter.sharedUsers.push(invitee.email);
        }

        invite.status = 'accepted';

        try {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
            await provider.getNetwork();

            const wallet = new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, provider);
            // Reusing __dirname shim for path resolution
            const contractABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../contractABI.json'), 'utf8'));
            const aclContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, contractABI, wallet);

            console.log("🔗 Connecting to Blockchain...");
            const tx = await aclContract.grantAccess(invite.workspaceId.toString(), req.user.id.toString());
            await tx.wait(1);
            console.log(`✅ Blockchain ACL Updated`);

        } catch (chainErr) {
            console.error("🛑 BLOCKCHAIN SYNC FAILED:", chainErr.message);
            return res.status(500).json({ msg: "Blockchain connection error. Please ensure Ganache is running." });
        }
        await invite.save(); await invitee.save(); await inviter.save();

        await new Activity({
            userId: req.user.id,
            type: 'INVITE_ACCEPTED',
            details: `Joined workspace "${workspace ? workspace.name : 'Shared Drive'}"`
        }).save();

        res.json({ msg: "Joined successfully!" });
    } catch (err) { res.status(500).send('Server Error'); }
});

// @route   DELETE /api/subscription/workspaces/:id
router.delete('/workspaces/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const workspace = user.workspacesCreated.id(req.params.id);

        if (!workspace) {
            return res.status(404).json({ msg: "Workspace record not found in your account." });
        }

        const wsName = workspace.name;
        const wsIdString = req.params.id.toString();

        try {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
            const wallet = new ethers.Wallet(process.env.SERVER_PRIVATE_KEY.trim(), provider);
            const contractABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../contractABI.json'), 'utf8'));
            const aclContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, contractABI, wallet);

            console.log(`⛓️ Revoking Blockchain Access for deletion: Workspace ${wsIdString}`);
            const tx = await aclContract.revokeAccess(wsIdString, req.user.id.toString());
            await tx.wait();
            console.log("✅ Blockchain ACL Cleaned.");
        } catch (chainErr) {
            console.error("🛑 Blockchain Revoke Failed during deletion:", chainErr.message);
        }

        try {
            const folderPath = `${user.email}/${wsName}/`;
            const objects = await s3.listObjectsV2({ Bucket: process.env.AWS_BUCKET_NAME, Prefix: folderPath }).promise();

            if (objects && objects.Contents.length > 0) {
                await s3.deleteObjects({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Delete: { Objects: objects.Contents.map(o => ({ Key: o.Key })) }
                }).promise();
            }
        } catch (s3Err) {
            console.warn("S3 folder already empty or missing.");
        }

        user.workspacesCreated.pull({ _id: req.params.id });
        await user.save();

        await User.updateMany(
            { workspacesJoined: req.params.id },
            { $pull: { workspacesJoined: req.params.id } }
        );

        await Invitation.deleteMany({ workspaceId: req.params.id });

        await new Activity({
            userId: req.user.id,
            type: 'WORKSPACE_DELETED',
            details: `"${wsName}"`
        }).save();

        res.json({ msg: "Workspace deleted, S3 cleaned, and quota reclaimed!" });
    } catch (err) {
        console.error("DELETE ERROR:", err);
        res.status(500).json({ msg: "Server error during workspace removal." });
    }
});

// @route   DELETE /api/subscription/revoke-invite/:id
router.delete('/revoke-invite/:id', auth, async (req, res) => {
    try {
        const invite = await Invitation.findById(req.params.id);
        if (!invite) return res.status(404).json({ msg: "Invitation not found." });
        if (invite.inviter.toString() !== req.user.id) {
            return res.status(401).json({ msg: "Unauthorized: You did not send this invite." });
        }
        if (invite.status !== 'pending') {
            return res.status(400).json({ msg: "Cannot revoke an invite that is already accepted or declined." });
        }
        await Invitation.findByIdAndDelete(req.params.id);
        res.json({ msg: "Invitation revoked successfully." });
    } catch (err) { res.status(500).send('Server Error'); }
});

// @route   POST /api/subscription/reject-invite/:id
router.post('/reject-invite/:id', auth, async (req, res) => {
    try {
        const invite = await Invitation.findById(req.params.id);
        if (!invite) return res.status(404).json({ msg: "Invitation not found." });
        const user = await User.findById(req.user.id);
        if (invite.inviteeEmail !== user.email.toLowerCase()) {
            return res.status(401).json({ msg: "Unauthorized" });
        }
        invite.status = 'declined';
        await invite.save();
        res.json({ msg: "Invitation declined." });
    } catch (err) { res.status(500).send('Server Error'); }
});

// @route   POST /api/subscription/create-checkout
router.post('/create-checkout', auth, async (req, res) => {
    try {
        const { plan } = req.body;
        const prices = {
            'Premium': 'price_1T7X7DPIa2p1PtKTUMUfe3Re',
            'Enterprise': 'price_1T7X7SPIa2p1PtKTqT2PlQeS'
        };

        const domainUrl = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:63342';
        const successUrl = `${domainUrl}/BCDM-demo/dashboard.html?success=true`;
        const cancelUrl = `${domainUrl}/BCDM-demo/dashboard.html?canceled=true`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: prices[plan], quantity: 1 }],
            mode: 'subscription',
            metadata: {
                planName: plan
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: req.user.id
        });

        res.json({ id: session.id });
    } catch (err) {
        console.error("💥 [STRIPE ERROR]:", err.message);
        res.status(500).json({ msg: "Stripe checkout failed", error: err.message });
    }
});

// @route   POST /api/subscription/customer-portal
router.post('/customer-portal', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.stripeCustomerId) {
            return res.status(400).json({ msg: "No active paid subscription found." });
        }
        const domainUrl = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:5001';
        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: `${domainUrl}/dashboard.html`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/subscription/leave-workspace/:id
router.post('/leave-workspace/:id', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const owner = await User.findOne({ "workspacesCreated._id": req.params.id });
        const workspace = owner ? owner.workspacesCreated.id(req.params.id) : null;
        const wsName = workspace ? workspace.name : "Shared Workspace";

        if (!user.workspacesJoined.includes(req.params.id)) {
            return res.status(400).json({ msg: "You are not a member of this workspace." });
        }

        try {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
            const wallet = new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, provider);
            const contractABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../contractABI.json'), 'utf8'));
            const aclContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, contractABI, wallet);

            console.log(`⛓️ Revoking Blockchain Access: User ${req.user.id} from Workspace ${req.params.id}`);
            const tx = await aclContract.revokeAccess(req.params.id.toString(), req.user.id.toString());
            await tx.wait();
            console.log("✅ Blockchain ACL Revoked.");
        } catch (chainErr) {
            console.error("Blockchain Revoke Failed:", chainErr.message);
        }

        user.workspacesJoined.pull(req.params.id);
        await user.save();

        try {
            await new Activity({
                userId: req.user.id,
                type: 'LEAVE_WORKSPACE',
                details: `"${wsName}"`
            }).save();
        } catch (logErr) {
            console.log("Activity logging failed.");
        }

        return res.status(200).json({ msg: `Successfully left "${wsName}" and revoked on-chain permissions.` });

    } catch (err) {
        console.error("LEAVE ERROR:", err);
        res.status(500).json({ msg: "Server Error" });
    }
});

export default router;