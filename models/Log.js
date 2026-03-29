// models/Log.js - ESM Version
import mongoose from 'mongoose';

const LogSchema = new mongoose.Schema({
    type: { type: String, required: true }, // e.g., 'SECURITY', 'UPLOAD', 'REGISTER'
    message: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed }, // Flexible field for extra JSON data

    // 🌐 Network Telemetry (Crucial for Velocity/Fraud detection)
    endpoint: { type: String },
    ipAddress: { type: String },
    location: { type: String, default: 'Unknown' },
    userAgent: { type: String },

    // 👤 Optional relation (if the action was done by a logged-in user)
    // Ensure this string matches the model name in User.js
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // 🕒 Timestamps
    timestamp: { type: Date, default: Date.now }
});

// 🚀 Indexing for Speed
LogSchema.index({ timestamp: -1 });
LogSchema.index({ ipAddress: 1, timestamp: -1 });

// Exporting the model as default for ESM
export default mongoose.model('Log', LogSchema);