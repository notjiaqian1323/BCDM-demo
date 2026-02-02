const crypto = require('crypto');
const algorithm = 'aes-256-ctr';
const secretKey = process.env.ENCRYPTION_KEY || 'vOVH6sdmpNWjRRIqCc7rdxs01lwHzfr3'; 

const encryptBuffer = (buffer) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
    return Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
};

const decryptBuffer = (encryptedBuffer) => {
    const iv = encryptedBuffer.slice(0, 16);
    const content = encryptedBuffer.slice(16);
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
    return Buffer.concat([decipher.update(content), decipher.final()]);
};

module.exports = { encryptBuffer, decryptBuffer };