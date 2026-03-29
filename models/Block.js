// models/Block.js - ESM Version
import mongoose from 'mongoose';

const BlockSchema = new mongoose.Schema({
    index: { type: Number, required: true },
    timestamp: { type: String, required: true },
    fileId: { type: String, required: true },
    fileHash: { type: String, required: true },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
    ethTxHash: { type: String, default: "Pending" }
});

// Exporting the model as default for ESM
export default mongoose.model('block', BlockSchema);