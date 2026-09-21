const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Xác định môi trường thực thi (Windows cục bộ hoặc Linux Container / Railway)
const isWin = process.platform === 'win32';
const localWinYtDlp = path.join(__dirname, 'bin', 'yt-dlp.exe');
const localWinFfmpeg = path.join(__dirname, 'bin', 'ffmpeg.exe');

// Nếu có sẵn binary Windows trong thư mục bin/ thì ưu tiên dùng; trên Linux / Docker dùng lệnh hệ thống 'yt-dlp'
const YT_DLP_PATH = (isWin && fs.existsSync(localWinYtDlp)) ? localWinYtDlp : 'yt-dlp';
const FFMPEG_DIR = (isWin && fs.existsSync(localWinFfmpeg)) ? path.join(__dirname, 'bin') : '';

// Đường dẫn node runtime
const NODE_PATH = process.execPath;

/**
 * Xử lý cookie YouTube nếu được cấu hình qua file hoặc biến môi trường (rất hữu ích khi deploy Cloud)
 */
function getCookiesPath() {
  // Nếu có biến môi trường YOUTUBE_COOKIES, ghi ra file tạm để yt-dlp đọc
  if (process.env.YOUTUBE_COOKIES) {
    const tmpCookies = path.join(os.tmpdir(), 'youtube_cookies.txt');
    try {
      fs.writeFileSync(tmpCookies, process.env.YOUTUBE_COOKIES, 'utf8');
      return tmpCookies;
    } catch (e) {
      console.warn('Không thể tạo file cookies tạm:', e.message);
    }
  }

  const localCookies = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(localCookies)) {
    return localCookies;
  }

  return null;
}

/**
 * Tạo danh sách tham số cơ sở cho yt-dlp
 */
function getBaseYtDlpArgs() {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', `node:"${NODE_PATH}"`
  ];

  if (FFMPEG_DIR) {
    args.push('--ffmpeg-location', FFMPEG_DIR);
  }

  const cookies = getCookiesPath();
  if (cookies) {
    args.push('--cookies', cookies);
  }

  if (process.env.PROXY_URL) {
    args.push('--proxy', process.env.PROXY_URL);
  }

  return args;
}

/**
 * Định dạng thời lượng từ giây sang mm:ss hoặc hh:mm:ss
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${m}:${pad(s)}`;
}

/**
 * Lọc tên file an toàn cho Content-Disposition
 */
function sanitizeFilename(filename, ext) {
  if (!filename) filename = 'video';
  let safe = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
  if (!safe) safe = 'download';
  return `${safe}.${ext}`;
}

/**
 * Kiểm tra tính hợp lệ của URL theo từng nền tảng
 */
function validatePlatformUrl(url, platform) {
  if (platform === 'facebook') {
    return /https?:\/\/(www\.|web\.|m\.)?(facebook\.com|fb\.watch|fb\.gg)/i.test(url);
  }
  if (platform === 'youtube') {
    return /https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)/i.test(url);
  }
  return false;
}

/**
 * API trích xuất thông tin video
 */
app.post('/api/download', (req, res) => {
  const { url, platform } = req.body;

  if (!url || !platform) {
    return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ liên kết và nền tảng.' });
  }

  if (!validatePlatformUrl(url, platform)) {
    const platformName = platform === 'facebook' ? 'Facebook' : 'YouTube';
    return res.status(400).json({
      error: `Đường dẫn không hợp lệ. Vui lòng nhập đúng liên kết video ${platformName}.`
    });
  }

  // Tham số chạy yt-dlp lấy JSON metadata
  const args = [
    '--dump-json',
    ...getBaseYtDlpArgs(),
    url
  ];

  execFile(YT_DLP_PATH, args, { maxBuffer: 15 * 1024 * 1024, timeout: 45000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('Lỗi khi trích xuất video:', stderr || err.message);
      if (err.killed) {
        return res.status(504).json({ error: 'Quá thời gian xử lý khi trích xuất video. Vui lòng thử lại.' });
      }
      return res.status(400).json({
        error: 'Không thể trích xuất video. Video có thể ở chế độ riêng tư, đã bị xóa hoặc liên kết không đúng.'
      });
    }

    try {
      const data = JSON.parse(stdout);
      const title = data.title || 'Video';
      const durationStr = formatDuration(data.duration);
      const uploader = data.uploader || data.channel || data.creator || '';
      const thumbnail = data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[0].url : '');

      let qualities = [];

      if (platform === 'youtube') {
        qualities = [
          {
            label: 'Full HD 1080p',
            quality: '1080p',
            type: 'video',
            ext: 'mp4',
            size: 'Chất lượng cao nhất'
          },
          {
            label: 'HD 720p',
            quality: '720p',
            type: 'video',
            ext: 'mp4',
            size: 'Chuẩn HD sắc nét'
          },
          {
            label: 'SD 480p',
            quality: '480p',
            type: 'video',
            ext: 'mp4',
            size: 'Tiêu chuẩn'
          },
          {
            label: 'SD 360p',
            quality: '360p',
            type: 'video',
            ext: 'mp4',
            size: 'Tiết kiệm dung lượng'
          },
          {
            label: 'Âm thanh MP3',
            quality: 'audio',
            type: 'audio',
            ext: 'mp3',
            size: 'Chỉ tải nhạc / âm thanh'
          }
        ];
      } else {
        // Facebook
        qualities = [
          {
            label: 'HD Siêu nét',
            quality: 'hd',
            type: 'video',
            ext: 'mp4',
            size: 'Chất lượng cao nhất'
          },
          {
            label: 'SD Tiêu chuẩn',
            quality: 'sd',
            type: 'video',
            ext: 'mp4',
            size: 'Độ nét tiêu chuẩn'
          },
          {
            label: 'Âm thanh MP3',
            quality: 'audio',
            type: 'audio',
            ext: 'mp3',
            size: 'Chỉ tải nhạc / âm thanh'
          }
        ];
      }

      // Đính kèm download URL cho từng chất lượng
      const baseUrl = '/api/stream';
      qualities = qualities.map((q) => {
        const queryParams = new URLSearchParams({
          url: url,
          quality: q.quality,
          type: q.type,
          title: title
        });
        return {
          ...q,
          downloadUrl: `${baseUrl}?${queryParams.toString()}`
        };
      });

      // Preview URL sử dụng luồng phát trực tiếp
      const previewParams = new URLSearchParams({
        url: url,
        quality: '360p',
        type: 'video',
        title: title,
        inline: '1'
      });
      const previewUrl = `${baseUrl}?${previewParams.toString()}`;

      return res.json({
        title,
        duration: durationStr,
        uploader,
        thumbnail,
        videoUrl: previewUrl,
        qualities
      });
    } catch (parseErr) {
      console.error('Lỗi phân tích JSON từ yt-dlp:', parseErr.message);
      return res.status(500).json({ error: 'Dữ liệu phản hồi từ trình trích xuất không hợp lệ.' });
    }
  });
});

/**
 * API tải / stream file video hoặc audio trực tiếp
 */
app.get('/api/stream', (req, res) => {
  const { url, quality = '720p', type = 'video', title = 'video', inline } = req.query;

  if (!url) {
    return res.status(400).send('Thiếu tham số URL.');
  }

  const isAudio = type === 'audio';
  const ext = isAudio ? 'mp3' : 'mp4';
  const filename = sanitizeFilename(title, ext);
  const dispositionType = inline === '1' ? 'inline' : 'attachment';

  // Thiết lập HTTP headers
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  let args = [
    ...getBaseYtDlpArgs()
  ];

  if (isAudio) {
    args.push('-x', '--audio-format', 'mp3', '-o', '-', url);
  } else {
    let formatSelector;
    switch (quality) {
      case '1080p':
        formatSelector = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
        break;
      case '720p':
      case 'hd':
        formatSelector = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
        break;
      case '480p':
        formatSelector = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
        break;
      case '360p':
      case 'sd':
        formatSelector = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
        break;
      default:
        formatSelector = 'bestvideo+bestaudio/best';
    }
    args.push('-f', formatSelector, '--remux-video', 'mp4', '-o', '-', url);
  }

  const child = spawn(YT_DLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Stream dữ liệu qua HTTP response
  child.stdout.pipe(res);

  let stderrOutput = '';
  child.stderr.on('data', (chunk) => {
    stderrOutput += chunk.toString();
  });

  child.on('error', (err) => {
    console.error('Lỗi khi khởi chạy tiến trình stream:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Không thể khởi tạo tiến trình tải dữ liệu.');
    }
  });

  child.on('close', (code) => {
    if (code !== 0 && !res.headersSent) {
      console.error('Tiến trình kết thúc với mã lỗi:', code, stderrOutput);
      res.status(500).send('Tải dữ liệu thất bại.');
    }
  });

  // Hủy tiến trình khi người dùng ngắt kết nối (đóng tab, hủy tải)
  req.on('close', () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint cho Railway / Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Platform: ${process.platform}, yt-dlp path: ${YT_DLP_PATH}`);
});
