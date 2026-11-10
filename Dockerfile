FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
RUN bun install --frozen-lockfile
COPY scripts ./scripts
COPY src ./src
# src/client.tsx dan kontrak API sudah di-commit dan diperiksa CI, jadi di sini hanya build proses dan layar konsol.
RUN bun scripts/build.ts

# Satu image untuk semua proses. Konsol berjalan secara bawaan dan menyajikan layar dari dist/client; agen dengan
# `bun dist/agent.js`, perintah operasional dengan `bun dist/cli.js`.
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
USER bun
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["bun", "dist/console.js"]
