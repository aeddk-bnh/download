# Sử dụng Node.js 20 trên nền Debian slim
FROM node:20-slim

# Cài đặt ffmpeg, python3, pip, git, curl và yt-dlp bản master kèm yt-dlp-ejs (chống bóp băng thông n-parameter 1MB/s)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    git \
    ca-certificates \
    && pip install --no-cache-dir --break-system-packages -U "git+https://github.com/yt-dlp/yt-dlp.git" yt-dlp-ejs curl_cffi \
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
