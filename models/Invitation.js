// models/Invitation.js - ESM Version
import mongoose from 'mongoose';

const InvitationSchema = new mongoose.Schema({
    inviter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    inviteeEmail: {
        type: String,
        required: true
    },
    // NEW: Link the invitation to a specific workspace ID
    workspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined'],
        default: 'pending'
    },
    date: {
        type: Date,
        default: Date.now
    }
});

// Exporting the model as default for ESM
export default mongoose.model('invitation', InvitationSchema);