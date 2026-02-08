const crypto = require('crypto');
require('dotenv').config(); // <--- CRITICAL: Ensure .env is loaded here too!

const algorithm = 'aes-256-ctr';
const secretKey = process.env.ENCRYPTION_KEY || 'vOVH6sdmpNWjRRIqCc7rdxs01lwHzfr3';

// --- 🛑 DEBUG CHECK 🛑 ---
// This prints the first 4 chars of the key so you can compare Server vs Worker
// DO NOT keep this in production.
console.log(`🔐 [CRYPTO DEBUG] Key used: ${secretKey.substring(0, 4)}... (Length: ${secretKey.length})`);

if (secretKey.length !== 32) {
    console.error("❌ CRITICAL ERROR: ENCRYPTION_KEY must be exactly 32 characters!");
}
// -------------------------

const encryptBuffer = (buffer) => {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
        const encrypted = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
        return encrypted;
    } catch (e) {
        console.error("Encryption Failed:", e.message);
        throw e;
    }
};

const decryptBuffer = (encryptedBuffer) => {
    try {
        const iv = encryptedBuffer.slice(0, 16);
        const content = encryptedBuffer.slice(16);
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
        const decrypted = Buffer.concat([decipher.update(content), decipher.final()]);
        return decrypted;
    } catch (e) {
        console.error("Decryption Failed (Likely Wrong Key):", e.message);
        throw e;
    }
};

module.exports = { encryptBuffer, decryptBuffer };