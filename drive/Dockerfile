FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --ignore-scripts --include=dev --legacy-peer-deps
COPY code/src/shared ./code/src/shared
COPY code/src/renderer/assets/moonmeter-icon.png ./code/src/renderer/assets/moonmeter-icon.png
COPY drive/src/server ./drive/src/server
COPY tsconfig.node.json ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["npm", "run", "server:start"]
