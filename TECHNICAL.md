# Tài liệu Kỹ thuật — Video Downloader (Facebook & YouTube)

## 1. Tổng quan

Ứng dụng web cho phép người dùng nhập liên kết video từ **Facebook** hoặc **YouTube**, tự động trích xuất thông tin (tiêu đề, ảnh thu nhỏ, thời lượng, tác giả) và tải video/audio về máy tính theo nhiều mức chất lượng (1080p, 720p, 480p, 360p, MP3) mà không bị giới hạn bản quyền hay lỗi chặn CORS.

- **Frontend**: HTML5, CSS3, JavaScript thuần (Vanilla JS), responsive đa thiết bị.
- **Backend**: Node.js + Express.js.
- **Core trích xuất & xử lý video**: Hỗ trợ đa nền tảng (`yt-dlp` và `ffmpeg` qua Windows binary cục bộ hoặc Linux package trong Container).
- **Môi trường triển khai**: Chạy trực tiếp trên Windows hoặc đóng gói Docker container chạy trên **Railway**, Render, Fly.io, VPS.

---

## 2. Cấu trúc thư mục

```
D:\download\
├── bin/                # File thực thi Windows (được .gitignore và .dockerignore loại trừ)
│   ├── yt-dlp.exe
│   ├── ffmpeg.exe
│   └── ffprobe.exe
├── public/
│   └── index.html      # Giao diện người dùng
├── Dockerfile          # Cấu hình build image Linux container
├── .dockerignore       # Loại trừ node_modules và bin/*.exe khi build
├── .gitignore          # Cấu hình Git loại trừ file nhạy cảm và binary nặng
├── railway.json        # Cấu hình chỉ định Dockerfile builder cho Railway
├── server.js           # Máy chủ Express (tự động nhận diện Windows / Linux)
├── package.json
├── TECHNICAL.md        # Tài liệu kỹ thuật
└── DONE.md             # Tiêu chuẩn hoàn thành và kiểm thử
```

---

## 3. Chi tiết API Backend

### 3.1 Kiểm tra trạng thái máy chủ
- **Endpoint**: `GET /health`
- **Response**: `{"status": "ok", "uptime": 12.34}`

### 3.2 Trích xuất thông tin video
- **Endpoint**: `POST /api/download`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "platform": "youtube"
  }
  ```
- **Response thành công (HTTP 200)**:
  ```json
  {
    "title": "Me at the zoo",
    "duration": "0:19",
    "uploader": "jawed",
    "thumbnail": "https://i.ytimg.com/vi/...",
    "videoUrl": "/api/stream?url=...&quality=360p&type=video&title=Me+at+the+zoo&inline=1",
    "qualities": [
      {
        "label": "Full HD 1080p",
        "quality": "1080p",
        "type": "video",
        "ext": "mp4",
        "size": "Chất lượng cao nhất",
        "downloadUrl": "/api/stream?url=...&quality=1080p&type=video&title=Me+at+the+zoo"
      },
      {
        "label": "HD 720p",
        "quality": "720p",
        "type": "video",
        "ext": "mp4",
        "size": "Chuẩn HD sắc nét",
        "downloadUrl": "/api/stream?url=...&quality=720p&type=video&title=Me+at+the+zoo"
      },
      {
        "label": "Âm thanh MP3",
        "quality": "audio",
        "type": "audio",
        "ext": "mp3",
        "size": "Chỉ tải nhạc / âm thanh",
        "downloadUrl": "/api/stream?url=...&quality=audio&type=audio&title=Me+at+the+zoo"
      }
    ]
  }
  ```

### 3.3 Tải / Stream Video & Audio về máy
- **Endpoint**: `GET /api/stream`
- **Query Parameters**:
  - `url`: Liên kết gốc của video.
  - `quality`: Mức chất lượng mong muốn (`1080p`, `720p`, `480p`, `360p`, `hd`, `sd`, `audio`).
  - `type`: `video` hoặc `audio`.
  - `title`: Tên video để tự động đặt tên file khi tải xuống.
  - `inline`: `1` nếu muốn xem trực tiếp trên player trình duyệt, để trống để tải về máy (`attachment`).

---

## 4. Hướng dẫn Triển khai lên Railway (Container Cloud)

### Bước 1: Khởi tạo Git và đẩy mã nguồn lên GitHub
Trong thư mục dự án `D:\download`:
```bash
git init
git add .
git commit -m "feat: setup docker and railway config"
git branch -M main
git remote add origin https://github.com/tai-khoan-cua-ban/video-downloader.git
git push -u origin main
```
*(File `.gitignore` và `.dockerignore` đã được cấu hình tự động loại trừ thư mục `bin/*.exe` và `node_modules`, giúp dung lượng repo siêu nhẹ < 1MB).*

### Bước 2: Tạo dự án trên Railway
1. Đăng nhập vào [Railway.app](https://railway.app/).
2. Nhấn **New Project** → Chọn **Deploy from GitHub repo**.
3. Chọn kho lưu trữ `video-downloader` vừa đẩy lên.
4. Railway sẽ tự động phát hiện `Dockerfile` và `railway.json` để tiến hành build container Linux trong ~30 giây.

### Bước 3: Tạo tên miền công khai (Public Domain)
1. Trong Dashboard Railway, chọn service vừa tạo → vào tab **Settings**.
2. Tại mục **Networking** / **Public Networking**, nhấn **Generate Domain**.
3. Bạn sẽ nhận được đường dẫn dạng: `https://video-downloader-production.up.railway.app`.

### Bước 4 (Tùy chọn): Cấu hình Vượt kiểm duyệt YouTube Bot Check (nếu cần)
Nếu IP của Datacenter gặp trường hợp YouTube yêu cầu xác thực bot:
- Trích xuất file `cookies.txt` từ trình duyệt của bạn (dùng extension như *Get cookies.txt LOCALLY*).
- Mở Dashboard Railway → tab **Variables** → Thêm biến:
  - Key: `YOUTUBE_COOKIES`
  - Value: Dán toàn bộ nội dung file `cookies.txt` vào đây.
- Server sẽ tự động nạp cookies và vượt qua kiểm duyệt.
