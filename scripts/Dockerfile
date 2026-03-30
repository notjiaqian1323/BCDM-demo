# /scripts/Dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install build essentials for bcrypt/native modules if needed
RUN apk add --no-cache python3 make g++

# Copy package files from the project root (context: ..)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the project files from the root
# 🚨 CHANGE THIS: Only copy what the Node Server/Worker needs
COPY server.js .
COPY worker.js .
COPY contractABI.json .
COPY routes/ ./routes/
COPY middleware/ ./middleware/
COPY models/ ./models/
COPY utils/ ./utils/
COPY artifacts/ ./artifacts/
# COPY config/ ./config/      # Add any other folders you use

# Expose the API port
EXPOSE 5001

# Note: The 'command' in docker-compose.yml overrides this,
# which allows us to use this same image for both Server and Worker.
CMD ["node", "server.js"]