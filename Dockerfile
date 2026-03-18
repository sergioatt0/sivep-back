FROM node:18-alpine

# Install Python and build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN npm prune --production

# Set production environment
ENV NODE_ENV=production

EXPOSE 5000

CMD ["npm", "start"]
