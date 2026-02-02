const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// --- 1. UPGRADED BLOCK CLASS (Generic Data) ---
class Block {
    constructor(index, timestamp, data, prevHash = "") {
        this.index = index;
        this.timestamp = timestamp;
        this.data = data; // Now stores an Object (File info OR Reputation info)
        this.prevHash = prevHash;
        this.hash = this.calculateHash();
    }
    calculateHash() {
        return crypto.createHash('sha256')
            .update(this.index + this.prevHash + this.timestamp + JSON.stringify(this.data))
            .digest('hex');
    }
}

class Blockchain {
    constructor() {
        this.chain = [this.createGenesisBlock()];
    }
    createGenesisBlock() {
        return new Block(0, new Date().toISOString(), { info: "GENESIS_BLOCK" }, "0");
    }
    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }
    addBlock(newBlock) {
        newBlock.prevHash = this.getLatestBlock().hash;
        newBlock.hash = newBlock.calculateHash();
        this.chain.push(newBlock);
    }
}

const myChain = new Blockchain();

// --- 2. GENERAL LOGGING ROUTE ---
// Accepts ANY event data: Files, Penalties, Bans
router.post('/log', (req, res) => {
    const { type, details } = req.body;

    // Example Input:
    // {
    //   type: "REPUTATION_PENALTY",
    //   details: { userId: "123", penalty: -10, reason: "PII Detected" }
    // }

    // --- MINE BLOCK ---
    const newBlock = new Block(
        myChain.chain.length,
        new Date().toISOString(),
        { type, ...details } // Store type + details together
    );

    myChain.addBlock(newBlock);

    res.json({
        message: "Event logged to Ledger",
        blockIndex: newBlock.index,
        blockHash: newBlock.hash,
        status: "IMMUTABLE"
    });
});

// @route   GET /api/blockchain/chain
router.get('/chain', (req, res) => {
    res.json(myChain.chain);
});

module.exports = router;