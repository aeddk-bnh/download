# Tiêu chuẩn Hoàn thành (Definition of Done) — Video Downloader

## 1. Yêu cầu Chức năng (Functional Requirements)

| ID | Yêu cầu | Trạng thái |
|----|---------|------------|
| FR-01 | Giao diện hiển thị ô nhập URL và nút "Tải về" | ✅ Hoàn thành |
| FR-02 | Tab chuyển đổi mượt mà giữa Facebook và YouTube | ✅ Hoàn thành |
| FR-03 | Xác thực URL đa dạng: hỗ trợ `facebook.com`, `fb.watch`, `fb.gg`, `reels`, `youtube.com`, `youtu.be`, `shorts` | ✅ Hoàn thành |
| FR-04 | Hiệu ứng loading dạng spinner kèm thông báo rõ ràng trong lúc xử lý | ✅ Hoàn thành |
| FR-05 | Thông báo lỗi tiếng Việt chính xác khi URL sai, video riêng tư hoặc bị xóa | ✅ Hoàn thành |
| FR-06 | Hiển thị thông tin chi tiết: Tiêu đề, Thời lượng, Tác giả, Ảnh thumbnail và khung preview | ✅ Hoàn thành |
| FR-07 | Danh sách các mức chất lượng (1080p, 720p, 480p, 360p) và tùy chọn tách âm thanh MP3 | ✅ Hoàn thành |
| FR-08 | Tự động tải file về máy tính với đúng định dạng (MP4/MP3) và tên video gốc | ✅ Hoàn thành |
| FR-09 | Hỗ trợ phím Enter để nhanh chóng kích hoạt tìm kiếm | ✅ Hoàn thành |
| FR-10 | Đổi theme màu sắc trực quan theo nền tảng (Xanh Facebook / Đỏ YouTube) | ✅ Hoàn thành |

---

## 2. Yêu cầu Phi chức năng & Hạ tầng (Non-Functional & Deployment)

| ID | Yêu cầu | Trạng thái |
|----|---------|------------|
| NFR-01 | Giao diện đáp ứng (responsive) chuẩn trên cả Mobile và Desktop | ✅ Hoàn thành |
| NFR-02 | Không phụ thuộc thư viện UI cồng kềnh ngoài Express và bộ core xử lý | ✅ Hoàn thành |
| NFR-03 | Tích hợp sẵn `yt-dlp` và `ffmpeg` trong thư mục `bin/`, chạy độc lập trên Windows | ✅ Hoàn thành |
| NFR-04 | Streaming dữ liệu trực tiếp qua HTTP pipeline, không ghi đệm tốn đĩa | ✅ Hoàn thành |
| NFR-05 | Đóng gói `Dockerfile` chuẩn hóa dựa trên `node:20-slim`, `ffmpeg` và `yt-dlp` Linux | ✅ Hoàn thành |
| NFR-06 | Cấu hình `.dockerignore` và `.gitignore` loại trừ file nặng, repo siêu nhẹ < 1MB | ✅ Hoàn thành |
| NFR-07 | Code `server.js` tự động nhận diện đa nền tảng (Windows local ↔ Linux container Railway) | ✅ Hoàn thành |
| NFR-08 | Hỗ trợ nạp `YOUTUBE_COOKIES` qua biến môi trường để chống bot detection trên Cloud | ✅ Hoàn thành |
| NFR-09 | Endpoint giám sát `GET /health` phục vụ Railway / Docker health check | ✅ Hoàn thành |

---

## 3. Danh sách kiểm tra nghiệm thu (Acceptance Criteria)

- [x] Chạy cục bộ trên Windows: Server nhận diện `D:\download\bin\yt-dlp.exe` và `ffmpeg.exe`.
- [x] Endpoint `GET /health` trả về `{"status": "ok", "uptime": ...}`.
- [x] Endpoint `POST /api/download` trích xuất thông tin video YouTube & Facebook thành công.
- [x] Endpoint `GET /api/stream` tải file video MP4 và audio MP3 thành công với đúng tên file.
- [x] Đã có đầy đủ file triển khai: `Dockerfile`, `.dockerignore`, `.gitignore`, `railway.json`.
- [x] Đã có tài liệu hướng dẫn từng bước đưa lên Railway trong `TECHNICAL.md`.
