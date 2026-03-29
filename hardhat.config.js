// Use .cjs extension to avoid ESM conflicts
import "@nomicfoundation/hardhat-toolbox";

export default {
    solidity: {
        version: "0.8.20",
        settings: {
            evmVersion: "paris",
            optimizer: { enabled: true, runs: 200 }
        }
    },
    networks: {
        ganache: {
            url: "http://127.0.0.1:8545",
            accounts: "remote"
        }
    }
};