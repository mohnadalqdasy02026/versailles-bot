FROM node:18-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create auth directory
RUN mkdir -p auth_info_baileys

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Start command
CMD ["npm", "start"]
