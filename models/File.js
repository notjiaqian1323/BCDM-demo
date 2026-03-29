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

    complianceStatus: {
        type: String,
        enum: ['pending', 'scanning', 'clean', 'redacted', 'failed', 'skipped', 'rejected'],
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

    // The JSON report from GLiNER
    piiReport: [
        {
            text: String,
            type: { type: String },
            page: Number,
            score: Number
        }
    ],
});

// Exporting the model as default for ESM
export default mongoose.model('file', FileSchema);