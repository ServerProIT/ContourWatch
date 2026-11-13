FROM node:24.11.1-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=8080 SECURE_COOKIES=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/main.mjs"]
