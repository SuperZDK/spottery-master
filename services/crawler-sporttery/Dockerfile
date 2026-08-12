FROM node:22-slim

RUN apt-get update && apt-get install -y chromium --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

RUN npm run build

CMD ["npm", "start"]
