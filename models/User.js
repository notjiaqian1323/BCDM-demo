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
    if (this.isBanned) return true;
    if (this.banExpires && this.banExpires > new Date()) return true;
    return false;
};

module.exports = mongoose.model('User', UserSchema);