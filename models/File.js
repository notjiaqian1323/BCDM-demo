// models/File.js - ESM Version
import mongoose from 'mongoose';

const FileSchema = new mongoose.Schema({
    // --- 1. BASIC FILE INFO ---
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: String, default: null },
    fileName: { type: String, required: true },
    s3Key: { type: String, required: true },
    fileSize: { type: Number, required: true },
    s3Url: { type: String },
    fileHash: { type: String },
    date: { type: Date, default: Date.now },

    // --- 2. SHARING FEATURES ---
    shareToken: { type: String, default: null },
    shareExpires: { type: Date, default: null },

    // --- 3. NEW: COMPLIANCE & PII FEATURES ---
    redactedS3Key: { type: String, default: null },

    // --- 4. NEW: IMMUTABLE FILE RECORDS LINKED TO CHAIN
    blockchainIndex: Number,
    ethTxHash: String,
    isDeleted: Boolean,

    complianceStatus: {
        type: String,
        // 🛠️ CHANGE 1: Added 'awaiting_review' to the enum
        enum: ['pending', 'scanning', 'awaiting_review', 'clean', 'redacted', 'failed', 'skipped', 'rejected'],
        default: 'pending'
    },

    riskScore: { type: Number, default: 100 },
    classification: {
        type: String,
        enum: ['PUBLIC', 'SENSITIVE', 'INTERNAL', 'RESTRICTED', 'UNKNOWN'],
        default: 'UNKNOWN'
    },
    riskKeywords: [String],
    rejectionReason: { type: String, default: '' },

    // The JSON report from GLiNER / Gemini
    piiReport: [
        {
            text: String,
            type: { type: String },
            page: Number,
            score: Number,
            // 🛠️ CHANGE 2: Added 'action' to track human decisions
            action: {
                type: String,
                enum: ['pending', 'redact', 'keep'],
                default: 'pending'
            }
        }
    ],
});

// Exporting the model as default for ESM
export default mongoose.model('file', FileSchema);