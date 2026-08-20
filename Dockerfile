FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY data ./data

RUN mkdir -p /app/public/avatars /app/data \
  && chown -R node:node /app

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/index.js"]
