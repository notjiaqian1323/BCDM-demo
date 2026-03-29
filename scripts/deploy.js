// scripts/deploy.js - ESM Version
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reconstruct __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    try {
        console.log("⏳ Reading compiled WorkspaceACL Contract...");

        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

        // This is a Ganache default deterministic key
        const privateKey = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
        const wallet = new ethers.Wallet(privateKey, provider);

        // Path to your compiled artifact
        const artifactPath = path.join(__dirname, "../artifacts/contracts/bcdm.sol/WorkspaceACL.json");

        if (!fs.existsSync(artifactPath)) {
            throw new Error(`❌ Artifact not found at ${artifactPath}. Did you run 'npx hardhat --config ../hardhat.config.cjs compile'?`);
        }

        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

        console.log("🚀 Deploying to Ganache...");
        const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

        // ethers v6 uses waitForDeployment()
        const contract = await factory.deploy();
        await contract.waitForDeployment();

        const contractAddress = await contract.getAddress();
        console.log(`✅ Contract deployed successfully to: ${contractAddress}`);

        // Update .env file
        const envPath = path.join(__dirname, "..", ".env");
        let envContent = fs.readFileSync(envPath, "utf8");

        // 🛡️ Logic Check: Ensure keys exist before replacing
        if (!envContent.includes("CONTRACT_ADDRESS=")) {
            envContent += `\nCONTRACT_ADDRESS=${contractAddress}`;
        } else {
            envContent = envContent.replace(/^CONTRACT_ADDRESS=.*/m, `CONTRACT_ADDRESS=${contractAddress}`);
        }

        if (!envContent.includes("SERVER_PRIVATE_KEY=")) {
            envContent += `\nSERVER_PRIVATE_KEY=${privateKey}`;
        } else {
            envContent = envContent.replace(/^SERVER_PRIVATE_KEY=.*/m, `SERVER_PRIVATE_KEY=${privateKey}`);
        }

        fs.writeFileSync(envPath, envContent);
        console.log("📝 .env file updated with new CONTRACT_ADDRESS and SERVER_PRIVATE_KEY.");

    } catch (error) {
        console.error("❌ DEPLOYMENT FATAL ERROR:");
        console.error(error.message || error);
        process.exit(1);
    }
}

main();