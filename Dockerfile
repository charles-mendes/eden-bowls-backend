FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY data ./data

RUN mkdir -p /app/public/avatars /app/public/feedback-photos /app/data \
  && chown -R node:node /app

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/index.js"]
