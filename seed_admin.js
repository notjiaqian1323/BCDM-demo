// seed_admin.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from './models/User.js'; // Note: In ESM, you often need the .js extension

dotenv.config();

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ DB Connected");

        // 1. Check if Admin already exists
        const exists = await User.findOne({ email: "admin@bcds.com" });
        if (exists) {
            console.log("⚠️ Admin account already exists.");
            process.exit();
        }

        // 2. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash("admin123", salt); // Change this password!

        // 3. Create Admin User
        const adminUser = new User({
            username: "SystemAdmin",
            email: "admin@bcds.com",
            password: hashedPassword,
            role: "admin", // <--- THE IMPORTANT PART
            trustScore: 100
        });

        await adminUser.save();
        console.log("🎉 Admin Account Created Successfully!");
        console.log("📧 Email: admin@bcds.com");
        console.log("🔑 Pass: admin123");

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

await createAdmin();