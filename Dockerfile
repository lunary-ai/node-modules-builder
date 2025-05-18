FROM oven/bun:1.2:13-debian
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["bun", "main.ts"]
