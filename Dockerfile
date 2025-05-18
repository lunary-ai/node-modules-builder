FROM oven/bun:1.2:13
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["bun", "main.ts"]
