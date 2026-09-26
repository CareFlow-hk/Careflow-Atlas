FROM node:24.15.0-slim
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node server ./server
USER node
ENV AUTH_HOST=0.0.0.0 AUTH_PORT=3001 AUTH_DB_PATH=/app/data/auth.sqlite
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
