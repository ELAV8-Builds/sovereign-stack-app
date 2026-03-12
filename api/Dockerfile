FROM node:22-slim

WORKDIR /app

# Install curl (healthcheck), git (code tools), grep + findutils (file search)
RUN apt-get update && apt-get install -y curl git grep findutils tree && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

EXPOSE 3100

CMD ["node", "dist/index.js"]
