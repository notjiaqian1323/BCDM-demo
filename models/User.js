const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // --- 1. IDENTITY ---
    username: { type: String, required: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // --- 2. STORAGE TRACKING ---
    package:  { type: String, default: 'Basic' },
    storageLimit: { type: Number, default: 52428800 }, // 50MB
    storageUsed:  { type: Number, default: 0 },
    date:     { type: Date, default: Date.now },

    // Dates
    subscriptionStart: { type: Date, default: Date.now },
    subscriptionEnd: { type: Date, default: null }, // Null means forever (Basic)

    // Team Sharing Features
    sharedUsers: { type: Array, default: [] }, // Array of emails they shared storage with
    maxSharedLimit: { type: Number, default: 0 }, // 0 for Basic, 10 Premium, 100 Ent.

    workspacesJoined: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],

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
    // Example Threshold: If score < 50, they are restricted
    return this.trustScore < 50;
};

// Helper method to check if user is banned
UserSchema.methods.checkBanStatus = function() {
    if (!this.isBanned) return false; // Not banned

    // Check if ban has expired
    if (this.banExpires && new Date() > this.banExpires) {
        this.isBanned = false;
        this.banReason = null;
        this.banExpires = null;
        this.save(); // Auto-unban
        return false;
    }
    return true; // Still banned
};

module.exports = mongoose.model('User', UserSchema);