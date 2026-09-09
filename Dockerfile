FROM node:22-slim AS base

WORKDIR /app

# Install Chromium dependencies for Playwright fallback
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libcairo2 libcups2 libxkbcommon0 libatspi2.0-0 \
    fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Install Playwright Chromium (only if no SERPER_API_KEY)
RUN npx playwright install chromium 2>/dev/null || true

# Copy source
COPY src/ src/
COPY web/ web/
COPY tsconfig.json ./

EXPOSE 3200

# Runtime env defaults
ENV PORT=3200
ENV NODE_ENV=production

CMD ["npx", "tsx", "src/server.ts"]
