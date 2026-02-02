const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.json());
app.use(cors());

// Serve "public" folder if you have shared assets (Optional)
//app.use('/public', express.static(path.join(__dirname, 'public')));

// --- 2. DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 3. API ROUTES ---
// Auth: Login, Register, User Info (with Trust Score)
app.use('/api/auth', require('./routes/auth'));

// Storage: Upload, Download, Share, Delete (Triggers Worker)
app.use('/api/storage', require('./routes/storage'));

// Blockchain: Immutable Log of Uploads & Penalties
app.use('/api/blockchain', require('./routes/blockchain'));

// Subscription: Manage Plan Limits (Basic/Premium)
app.use('/api/subscription', require('./routes/subscription'));

app.use('/api/admin', require('./routes/admin'));

// --- 4. GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ msg: 'Something went wrong!', error: err.message });
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API Access: http://localhost:${PORT}/api/`);
});