// utils/encryption.js - ESM Version
import crypto from 'node:crypto';
import 'dotenv/config'; // 🚨 CRITICAL: Standard ESM way to load .env

const algorithm = 'aes-256-ctr';
const secretKey = process.env.ENCRYPTION_KEY || 'vOVH6sdmpNWjRRIqCc7rdxs01lwHzfr3';

// --- 🛑 DEBUG CHECK 🛑 ---
console.log(`🔐 [CRYPTO DEBUG] Key used: ${secretKey.substring(0, 4)}... (Length: ${secretKey.length})`);

if (secretKey.length !== 32) {
    console.error("❌ CRITICAL ERROR: ENCRYPTION_KEY must be exactly 32 characters!");
}
// -------------------------

// Exporting as a named export
export const encryptBuffer = (buffer) => {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
        return Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
    } catch (e) {
        console.error("Encryption Failed:", e.message);
        throw e;
    }
};

// Exporting as a named export
export const decryptBuffer = (encryptedBuffer) => {
    try {
        const iv = encryptedBuffer.slice(0, 16);
        const content = encryptedBuffer.slice(16);
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
        return Buffer.concat([decipher.update(content), decipher.final()]);
    } catch (e) {
        console.error("Decryption Failed (Likely Wrong Key):", e.message);
        throw e;
    }
};