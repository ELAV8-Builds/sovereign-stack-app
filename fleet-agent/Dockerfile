FROM node:22-slim

RUN apt-get update && apt-get install -y curl docker.io && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --production

EXPOSE 3300

CMD ["node", "dist/index.js"]
