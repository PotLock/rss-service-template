FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies and wget for healthcheck
RUN apk add --no-cache wget && npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Set default port and expose it
ARG PORT=4001
EXPOSE $PORT

# Set environment variables
ENV NODE_ENV=production
ENV PORT=$PORT

# Create a non-root user and switch to it
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:$PORT/health || exit 1

# Start the application
CMD ["npm", "start"]
