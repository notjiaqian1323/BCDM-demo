#!/bin/bash



# --- 🎨 COLOR VARIABLES FOR READABILITY ---

GREEN='\033[0;32m'

RED='\033[0;31m'

YELLOW='\033[1;33m'

BLUE='\033[0;34m'

NC='\033[0m' # No Color



# --- 🛠️ LOGGING HELPER FUNCTIONS ---

log_step() { echo -e "\n${BLUE}========================================${NC}\n${BLUE}▶ $1${NC}\n${BLUE}========================================${NC}"; }

log_info() { echo -e "${YELLOW}[INFO] $1${NC}"; }

log_success() { echo -e "${GREEN}[SUCCESS] $1${NC}"; }

log_error() { echo -e "${RED}[ERROR] $1${NC}"; }



# Exit immediately if a command exits with a non-zero status

set -e

# Trap unexpected errors and log the exact line number

trap 'log_error "Script crashed unexpectedly at line $LINENO. Review the logs above."; exit 1' ERR





log_step "STEP 1: Starting Local Blockchain (Ganache)"

log_info "Cleaning up Ganache and Stripe processes..."
pkill -f ganache || true
pkill -f stripe || true
npx kill-port 8545 5001 8000 || true
sleep 2



log_info "Booting Ganache CLI in the background. Full output saving to 'ganache.log'..."

# Standard ganache call

npx ganache -p 8545 --deterministic > ganache.log 2>&1 &

GANACHE_PID=$!



# Health Check

sleep 3

if ! curl -s http://127.0.0.1:8545 > /dev/null; then

log_error "Ganache failed to start or isn't responding on port 8545!"

cat ganache.log

exit 1

fi

log_success "Ganache is running (PID: $GANACHE_PID)."





log_step "STEP 2: Compiling & Deploying Smart Contract"

log_info "Compiling Solidity with Hardhat..."



set +e

# 🚨 ESM FIX: Pointing to the .cjs config explicitly

npx hardhat --config ../hardhat.config.js compile > compile.log 2>&1



if [ $? -ne 0 ]; then

log_error "Hardhat Compilation failed! Check compile.log"

cat compile.log

exit 1

fi



log_info "Running Node.js deployment script..."

# 🚨 ESM FIX: Ensure deploy.js has been converted to 'import' or renamed to .cjs

# If you haven't changed the code inside deploy.js yet, use: node scripts/deploy.cjs

node deploy.js 2>&1 | tee deploy.log

DEPLOY_STATUS=$?



if [ $DEPLOY_STATUS -ne 0 ]; then

log_error "Smart contract deployment failed!"

echo "--- DEPLOYMENT ERROR LOG ---"

cat deploy.log

exit 1

fi



log_success "Contract deployed and .env updated!"

if [ -s deploy.log ]; then

grep "✅\|📝" deploy.log || true

fi





log_step "STEP 3: Setting up Stripe Webhook"

log_info "Starting Stripe CLI listener..."

.././stripe listen --forward-to localhost:5001/api/subscription/webhook > stripe.log 2>&1 &

STRIPE_PID=$!



sleep 4

if grep -q "whsec_" stripe.log; then

STRIPE_SECRET=$(grep -o "whsec_[^ ]*" stripe.log | head -1)

# Using 'sed' to update the .env for the Node API to consume

sed -i.bak "s/^STRIPE_WEBHOOK_SECRET=.*/STRIPE_WEBHOOK_SECRET=$STRIPE_SECRET/" ../.env && rm -f .env.bak

log_success "Stripe webhook configured successfully."

else

log_error "Failed to capture Stripe webhook secret."

log_info "Ensure you have run './stripe login' recently."

exit 1

fi




log_step "STEP 4: Booting Docker Containers"

log_info "Building and starting Docker services..."

# Note: Since your package.json has 'type: module', the Dockerfile for your

# Node API must use a Node 18+ base image to support ESM natively.



set +e

docker-compose -f ./docker-compose.yml up --build --force-recreate -d > docker_build.log 2>&1

DOCKER_STATUS=$?

set -e



if [ $DOCKER_STATUS -ne 0 ]; then

log_error "Docker Compose failed! Check docker_build.log"

exit 1

fi

log_success "All Docker containers are up and running!"





log_step "🎉 SYSTEM IS LIVE!"

log_success "Your ESM-Powered NLP Blockchain Cloud is fully operational."

echo -e "${YELLOW}API Server:${NC} http://localhost:5001"

echo -e "${YELLOW}Python NLP Engine:${NC} http://localhost:8000"

echo -e "\n${BLUE}To monitor the ESM logs, use:${NC}"

echo -e "docker-compose logs -f\n"