const mongoose = require('mongoose');

// ⚠️ Replace this with your actual User model path
const User = require('./models/User');

// ⚠️ Replace with your actual MongoDB connection string from your .env file
const MONGO_URI = 'mongodb+srv://q12w15e2003_db_user:LMt49_kf2RAVuZ3@cluster0.vg5kn7m.mongodb.net/?appName=Cluster0';

const seedUsers = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB.');

        const usersToInsert = [];
        const packages = ['Basic', 'Pro', 'Enterprise'];
        const role = 'user';

        // Generate 25 unique mock users
        for (let i = 1; i <= 25; i++) {
            // Randomize trust score between 20 and 100
            const trustScore = Math.floor(Math.random() * 81) + 20;
            const isBanned = trustScore < 40; // Automatically ban users with terrible scores
            const randomDaysAgo = Math.floor(Math.random() * 365); // Random join date within the last year

            const joinDate = new Date();
            joinDate.setDate(joinDate.getDate() - randomDaysAgo);

            usersToInsert.push({
                username: `test_user_${i}_${Math.random().toString(36).substring(7)}`,
                email: `test${i}@mockdata.com`,
                // Standard mock password hash for testing
                password: '$2b$10$lhoD7Bs2VeRjwNfswYMR.uKXcsxsiKuP7I8QL9I302JTgVijjvKAq',
                package: packages[Math.floor(Math.random() * packages.length)],
                storageLimit: 52428800,
                storageUsed: Math.floor(Math.random() * 20000000), // Random storage used
                subscriptionEnd: null,
                sharedUsers: [],
                maxSharedLimit: 0,
                workspacesJoined: [],
                role: role,
                trustScore: trustScore,
                lastPenaltyDate: isBanned ? new Date() : null,
                violationCount: isBanned ? Math.floor(Math.random() * 5) + 1 : 0,
                isBanned: isBanned,
                banReason: isBanned ? "Automated mock ban for low trust score." : null,
                banExpires: null,
                lastUploadTime: new Date(),
                rapidUploadSpamCount: 0,
                date: joinDate,
                subscriptionStart: joinDate,
                workspacesCreated: []
            });
        }

        // Insert into MongoDB
        console.log('⏳ Seeding 25 mock users...');
        await User.insertMany(usersToInsert);

        console.log('🎉 Successfully seeded 25 users!');
        process.exit();

    } catch (err) {
        console.error('💥 Seeder failed:', err);
        process.exit(1);
    }
};

seedUsers();