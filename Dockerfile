FROM oven/bun:latest
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["bun", "main.ts"]
