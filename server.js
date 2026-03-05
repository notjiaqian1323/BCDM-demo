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
// Admin: Manage Users, Monitoring, Banning
app.use('/api/admin', require('./routes/admin'));

// --- 4. GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ msg: 'Something went wrong!', error: err.message });
});

app.post('/api/subscription/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Signature Verification Failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const User = require('./models/User');
    const Activity = require('./models/Activity');

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const purchasedPlan = session.metadata.planName;

        const user = await User.findById(userId);
        if (user) {
            user.stripeCustomerId = session.customer;
            user.package = purchasedPlan;
            // Precise byte calculation
            user.storageLimit = purchasedPlan === 'Enterprise' ? 500 * 1024 * 1024 * 1024 : 100 * 1024 * 1024 * 1024;

            await user.save();
            await new Activity({
                userId: user._id,
                type: 'PAYMENT_SUCCESS',
                details: `Upgraded to ${purchasedPlan}`
            }).save();
            console.log(`⭐ Plan updated for user: ${user.email}`);
        }
    }

    // Handle recurring billing updates
    if (event.type === 'invoice.paid') {
        const session = event.data.object;
        const user = await User.findOne({ stripeCustomerId: session.customer });
        if (user) {
            // Stripe provides timestamps in seconds, JS needs milliseconds
            user.subscriptionEnd = new Date(session.period_end * 1000);
            await user.save();
        }
    }

    res.json({received: true});
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API Access: http://localhost:${PORT}/api/`);
});