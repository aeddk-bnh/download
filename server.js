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

// Bộ nhớ đệm cache metadata (TTL: 10 phút)
const metadataCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCachedMetadata(key) {
  const item = metadataCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    metadataCache.delete(key);
    return null;
  }
  return item.data;
}

function setCachedMetadata(key, data) {
  if (metadataCache.size > 200) {
    const firstKey = metadataCache.keys().next().value;
    metadataCache.delete(firstKey);
  }
  metadataCache.set(key, { timestamp: Date.now(), data });
}

/**
 * Chuẩn hóa một dòng cookie sang định dạng Netscape chuẩn (ngăn cách bằng ký tự TAB)
 */
function normalizeNetscapeLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return line;
  if (line.includes('\t')) return line;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 7) {
    const first6 = parts.slice(0, 6);
    const rest = parts.slice(6).join(' ');
    return first6.join('\t') + '\t' + rest;
  }
  return line;
}

/**
 * Xử lý cookie YouTube nếu được cấu hình qua file hoặc biến môi trường
 */
function getCookiesPath() {
  if (process.env.YOUTUBE_COOKIES) {
    const tmpCookies = path.join(os.tmpdir(), 'youtube_cookies.txt');
    try {
      let raw = process.env.YOUTUBE_COOKIES.trim();
      if (raw.includes('\\n') && !raw.includes('\n')) {
        raw = raw.replace(/\\n/g, '\n');
      }
      const lines = raw.split('\n').map(normalizeNetscapeLine);
      let formattedContent = lines.join('\n');
      if (!formattedContent.startsWith('# Netscape HTTP Cookie File')) {
        formattedContent = '# Netscape HTTP Cookie File\n' + formattedContent;
      }
      fs.writeFileSync(tmpCookies, formattedContent + '\n', 'utf8');
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
function getBaseYtDlpArgs(platform, options = { useCookies: true }) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', 'node'
  ];

  if (options.useCookies) {
    const cookies = getCookiesPath();
    if (cookies) {
      args.push('--cookies', cookies);
    }
  }

  if (FFMPEG_DIR) {
    args.push('--ffmpeg-location', FFMPEG_DIR);
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
 * Cơ chế trích xuất thông minh đa tầng (Smart Multi-Tier Fallback)
 * Tự động vượt qua các lỗi: "The page needs to be reloaded", "Requested format is not available", "Bot check"
 */
function extractVideoMetadataWithFallback(url, platform, callback) {
  // Tầng 1: Sử dụng cấu hình tiêu chuẩn (kèm cookies nếu có)
  const argsTier1 = [
    '--dump-json',
    ...getBaseYtDlpArgs(platform, { useCookies: true }),
    url
  ];

  execFile(YT_DLP_PATH, argsTier1, { maxBuffer: 15 * 1024 * 1024, timeout: 45000 }, (err1, stdout1, stderr1) => {
    if (!err1 && stdout1) {
      try {
        const data = JSON.parse(stdout1);
        return callback(null, data, 'default');
      } catch (e) {}
    }

    // Nếu không phải YouTube hoặc timeout thì kết thúc
    if (platform !== 'youtube' || (err1 && err1.killed)) {
      return callback(err1, null, 'default', stderr1);
    }

    const err1Text = (stderr1 || err1.message || '').trim();
    console.log(`[YouTube] Tầng 1 gặp lỗi (${err1Text.split('\n')[0]}). Đang tự động kích hoạt Tầng 2 (Android Client)...`);

    // Tầng 2: Fallback sang Android Client (không dùng cookies để tránh xung đột định dạng)
    // Client Android rất bền bỉ, không bị lỗi "The page needs to be reloaded"
    const argsTier2 = [
      '--dump-json',
      ...getBaseYtDlpArgs(platform, { useCookies: false }),
      '--extractor-args', 'youtube:player_client=android',
      url
    ];

    execFile(YT_DLP_PATH, argsTier2, { maxBuffer: 15 * 1024 * 1024, timeout: 45000 }, (err2, stdout2, stderr2) => {
      if (!err2 && stdout2) {
        try {
          const data = JSON.parse(stdout2);
          return callback(null, data, 'android');
        } catch (e) {}
      }

      const err2Text = (stderr2 || err2.message || '').trim();
      console.log(`[YouTube] Tầng 2 gặp lỗi (${err2Text.split('\n')[0]}). Đang tự động kích hoạt Tầng 3 (iOS Client)...`);

      // Tầng 3: Fallback sang iOS Client
      const argsTier3 = [
        '--dump-json',
        ...getBaseYtDlpArgs(platform, { useCookies: false }),
        '--extractor-args', 'youtube:player_client=ios',
        url
      ];

      execFile(YT_DLP_PATH, argsTier3, { maxBuffer: 15 * 1024 * 1024, timeout: 45000 }, (err3, stdout3, stderr3) => {
        if (!err3 && stdout3) {
          try {
            const data = JSON.parse(stdout3);
            return callback(null, data, 'ios');
          } catch (e) {}
        }

        return callback(err3 || err2 || err1, null, 'default', stderr3 || stderr2 || stderr1);
      });
    });
  });
}

/**
 * API trích xuất thông tin video (kèm cache tăng tốc và fallback thông minh)
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

  // Kiểm tra cache trước để trả lời tức thì
  const cacheKey = `${platform}:${url.trim()}`;
  const cachedData = getCachedMetadata(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }

  extractVideoMetadataWithFallback(url, platform, (err, data, activeClient, stderr) => {
    if (err || !data) {
      console.error('Lỗi khi trích xuất video:', stderr || (err && err.message));
      if (err && err.killed) {
        return res.status(504).json({ error: 'Quá thời gian xử lý khi trích xuất video. Vui lòng thử lại.' });
      }

      const errText = stderr || (err && err.message) || '';
      let userError = 'Không thể trích xuất video. Video có thể ở chế độ riêng tư, đã bị xóa hoặc liên kết không đúng.';

      if (errText.includes("Sign in to confirm you're not a bot") || errText.includes('HTTP Error 429')) {
        userError = 'YouTube chặn IP máy chủ Cloud và yêu cầu xác thực Bot. Vui lòng thêm biến môi trường YOUTUBE_COOKIES trên Railway.';
      } else {
        const errorLines = errText.split('\n').filter(l => l.includes('ERROR:'));
        if (errorLines.length > 0) {
          userError = errorLines.join('; ').replace(/ERROR:\s*/g, '');
        }
      }

      return res.status(400).json({
        error: userError,
        details: errText.substring(0, 300)
      });
    }

    try {
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

      // Đính kèm download URL cho từng chất lượng với activeClient tương ứng
      const baseUrl = '/api/stream';
      qualities = qualities.map((q) => {
        const queryParams = new URLSearchParams({
          url: url,
          quality: q.quality,
          type: q.type,
          title: title,
          platform: platform,
          client: activeClient
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
        platform: platform,
        client: activeClient,
        inline: '1'
      });
      const previewUrl = `${baseUrl}?${previewParams.toString()}`;

      const responsePayload = {
        title,
        duration: durationStr,
        uploader,
        thumbnail,
        videoUrl: previewUrl,
        qualities
      };

      // Lưu cache kết quả
      setCachedMetadata(cacheKey, responsePayload);

      return res.json(responsePayload);
    } catch (parseErr) {
      console.error('Lỗi xử lý metadata:', parseErr.message);
      return res.status(500).json({ error: 'Dữ liệu phản hồi từ trình trích xuất không hợp lệ.' });
    }
  });
});

/**
 * API tải / stream file video hoặc audio trực tiếp
 * Hỗ trợ đa luồng concurrent-fragments, buffer size và client phù hợp
 */
app.get('/api/stream', (req, res) => {
  const { url, quality = '720p', type = 'video', title = 'video', platform = 'youtube', client = 'default', inline } = req.query;

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

  // Nếu client là android hoặc ios, không dùng cookies web để tránh xung đột
  const useCookies = (client === 'default');

  let args = [
    ...getBaseYtDlpArgs(platform, { useCookies }),
    '--concurrent-fragments', '8',
    '--buffer-size', '16M',
    '--http-chunk-size', '10M',
    '--throttled-rate', '100K'
  ];

  if (platform === 'youtube' && client && client !== 'default') {
    args.push('--extractor-args', `youtube:player_client=${client}`);
  }

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
