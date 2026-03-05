const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
    type: { type: String, required: true }, // e.g., 'SECURITY', 'UPLOAD', 'REGISTER'
    message: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed }, // Flexible field for extra JSON data

    // 🌐 Network Telemetry (Crucial for Velocity/Fraud detection)
    endpoint: { type: String },
    ipAddress: { type: String },
    location: { type: String, default: 'Unknown' }, // <--- ADD THIS
    userAgent: { type: String },

    // 👤 Optional relation (if the action was done by a logged-in user)
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // 🕒 Timestamps
    timestamp: { type: Date, default: Date.now }
});

// 🚀 Pro-Tip: Indexing for Speed
// We index the timestamp and ipAddress because we will query them heavily
LogSchema.index({ timestamp: -1 });
LogSchema.index({ ipAddress: 1, timestamp: -1 });

module.exports = mongoose.model('Log', LogSchema);