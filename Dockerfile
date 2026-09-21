# Sử dụng Node.js 20 trên nền Debian slim (glibc chuẩn, tương thích hoàn hảo với ffmpeg)
FROM node:20-slim

# Cài đặt ffmpeg, python3, curl và các chứng chỉ bảo mật cần thiết
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Cài đặt dependencies cho production
COPY package*.json ./
RUN npm install --omit=dev

# Sao chép mã nguồn ứng dụng
COPY . .

# Railway tự động cấp biến PORT, mặc định là 3000
ENV PORT=3000
EXPOSE 3000

# Khởi động ứng dụng
CMD ["node", "server.js"]
