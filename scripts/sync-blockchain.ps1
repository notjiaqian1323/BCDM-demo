# 1. Deploy the contract (updates .env)
Write-Host "🚀 Deploying Smart Contract to Ganache..." -ForegroundColor Cyan
node deploy.js

# 2. Tell Docker to refresh the API server with the new .env
Write-Host "🔄 Refreshing API Server with new Contract Address..." -ForegroundColor Yellow
docker-compose -f docker-compose.yml up -d api-server

Write-Host "✅ Sync Complete! Your API is now pointing to the new contract." -ForegroundColor Green