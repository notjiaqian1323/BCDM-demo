const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// 🛠️ PERFORMANCE FIX: Move these imports to the top level!
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('./models/User');
const Activity = require('./models/Activity');

const app = express();

// --- 1. STRIPE WEBHOOK (Perfectly positioned above express.json!) ---
app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("💥 Webhook Signature Verification Failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        // --- EVENT: NEW SUBSCRIPTION ---
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;

            const userId = session.client_reference_id;
            const purchasedPlan = session.metadata.planName;

            const user = await User.findById(userId);
            if (user) {
                user.package = purchasedPlan;

                if (purchasedPlan === 'Premium') {
                    user.storageLimit = 100 * 1024 * 1024 * 1024; // 100GB
                } else if (purchasedPlan === 'Enterprise') {
                    user.storageLimit = 500 * 1024 * 1024 * 1024; // 500GB
                }

                user.stripeCustomerId = session.customer;
                await user.save();

                await new Activity({
                    userId: user._id,
                    type: 'PAYMENT_SUCCESS',
                    details: `Upgraded to ${purchasedPlan}`
                }).save();
                console.log(`⭐ Plan updated for user: ${user.email}`);
            }
        }

        // --- EVENT: RECURRING RENEWAL ---
        if (event.type === 'invoice.paid') {
            const session = event.data.object;
            const user = await User.findOne({ stripeCustomerId: session.customer });

            if (user && session.lines && session.lines.data.length > 0) {
                // 🛠️ BUG FIX: Correctly pathing to the end timestamp
                user.subscriptionEnd = new Date(session.lines.data[0].period.end * 1000);
                await user.save();
                console.log(`🔄 Subscription renewed for user: ${user.email}`);
            }
        }

        res.json({ received: true });

    } catch (dbError) {
        console.error("💥 Database Error inside Webhook:", dbError);
        res.status(500).send("Database Update Failed");
    }
});

// --- 2. MIDDLEWARE ---
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

// --- 3. ROUTES ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/storage', require('./routes/storage'));
app.use('/api/blockchain', require('./routes/blockchain'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));

// --- 4. GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ msg: 'Something went wrong!', error: err.message });
});

// --- 5. DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err.message);
    });

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));