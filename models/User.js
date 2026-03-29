// models/User.js - ESM Version
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // Allows MongoDB to save the Stripe connection
    stripeCustomerId: { type: String, default: null },

    // Subscription & Storage
    package: { type: String, default: 'Basic' },
    storageLimit: { type: Number, default: 52428800 }, // EXACTLY 50MB in bytes
    storageUsed: { type: Number, default: 0 },

    // Dates
    subscriptionStart: { type: Date, default: Date.now },
    subscriptionEnd: { type: Date, default: null }, // Null means forever (Basic)

    // Team Sharing Features
    sharedUsers: { type: Array, default: [] }, // Array of emails they shared storage with
    maxSharedLimit: { type: Number, default: 0 }, // 0 for Basic, 10 Premium, 100 Ent.

    workspacesJoined: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],

    date: { type: Date, default: Date.now },

    // Workspace Creation Tracking
    workspacesCreated: [{
        name: { type: String, required: true },
        allocatedBytes: { type: Number, required: true },
        createdAt: { type: Date, default: Date.now }
    }],

    // --- NEW: ROLE MANAGEMENT ---
    role: {
        type: String,
        enum: ['user', 'admin'], // Strict validation
        default: 'user'          // Everyone who registers is a 'user' by default
    },

    // --- 3. REPUTATION & TRUST SYSTEM (New!) ---
    trustScore: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
    },

    // Track when the last penalty happened
    lastPenaltyDate: { type: Date, default: null },

    // Track violations to justify score drops (Optional audit trail)
    violationCount: { type: Number, default: 0 },

    // --- 4. BAN & RESTRICTION LOGIC ---
    // If true, user is completely locked out
    isBanned: { type: Boolean, default: false },

    banReason: {
        type: String,
        default: null // Stores "Violation of Terms" or "Spamming"
    },

    // If set, user is temporarily suspended until this date
    banExpires: { type: Date, default: null },

    // --- 5. RATE LIMITING (Anti-DDoS) ---
    // We track the last time they tried to upload to detect spamming
    lastUploadTime: { type: Date, default: null },
    rapidUploadSpamCount: { type: Number, default: 0 }
});

// Helper method to check if user is currently restricted
UserSchema.methods.isRestricted = function() {
    return this.trustScore < 50;
};

// Helper method to check if user is banned
UserSchema.methods.checkBanStatus = function() {
    if (!this.isBanned) return false;

    if (this.banExpires && new Date() > this.banExpires) {
        this.isBanned = false;
        this.banReason = null;
        this.banExpires = null;
        this.save();
        return false;
    }
    return true;
};

// Exporting the model as default for ESM
export default mongoose.model('User', UserSchema);