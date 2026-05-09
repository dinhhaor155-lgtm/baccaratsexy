FROM mcr.microsoft.com/playwright:v1.53.0-noble

WORKDIR /app

ENV NODE_ENV=production
ENV HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
