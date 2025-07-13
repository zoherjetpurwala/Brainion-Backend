# Use an official Node.js image
FROM node:18

# Set the working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port (optional, useful if running locally)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
