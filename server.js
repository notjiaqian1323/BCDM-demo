import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Stripe from 'stripe';

// --- 1. ESM SETUP (__dirname shim) ---
// Since ESM doesn't have __dirname, we recreate it here
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// --- 2. MODELS & STRIPE IMPORT ---
// 🚨 CRITICAL: You must include the .js extension for local files
import User from './models/User.js';
import Activity from './models/Activity.js';

// Import routes
import authRoutes from './routes/auth.js';
import storageRoutes from './routes/storage.js';
import blockchainRoutes from './routes/blockchain.js';
import subscriptionRoutes from './routes/subscription.js';
import activityRoutes from './routes/activity.js';
import reportsRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// --- 3. STRIPE WEBHOOK ---
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

        if (event.type === 'invoice.paid') {
            const session = event.data.object;
            const user = await User.findOne({ stripeCustomerId: session.customer });
            if (user && session.lines && session.lines.data.length > 0) {
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

// --- 4. MIDDLEWARE ---
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

// --- 5. ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/blockchain', blockchainRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);

// --- 6. GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ msg: 'Something went wrong!', error: err.message });
});

// --- 7. DATABASE CONNECTION ---
// ESM supports top-level await, but keeping the .then structure for now is fine
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err.message);
    });

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));