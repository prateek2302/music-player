const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const LIBRARY_FILE = path.join(DATA_DIR, "tracks.json");
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const sampleTracks = [
  { id: "sample-golden-hour", title: "Golden hour", artist: "Luna Bloom", album: "Soft edges", duration: "3:42", category: "Chill", art: "amber", symbol: "☼", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", liked: false, local: false },
  { id: "sample-blue-in-green", title: "Blue in green", artist: "The Sunday Club", album: "Rooms with a view", duration: "4:08", category: "Focus", art: "blue", symbol: "◒", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", liked: false, local: false },
  { id: "sample-soft-focus", title: "Soft focus", artist: "Mila June", album: "Somewhere slow", duration: "3:26", category: "Chill", art: "pink", symbol: "✳", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", liked: false, local: false },
  { id: "sample-after-the-rain", title: "After the rain", artist: "Juniper Lane", album: "Open windows", duration: "3:51", category: "Upbeat", art: "lilac", symbol: "☁", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", liked: false, local: false },
  { id: "sample-little-by-little", title: "Little by little", artist: "Noah Ellis", album: "Small hours", duration: "4:13", category: "Focus", art: "green", symbol: "⌁", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", liked: false, local: false },
  { id: "sample-sunroom", title: "Sunroom", artist: "The Sunday Club", album: "Rooms with a view", duration: "3:34", category: "Upbeat", art: "rust", symbol: "☀", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3", liked: false, local: false },
];

const audioTypes = new Map([
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".wav", "audio/wav"],
  [".weba", "audio/webm"],
  [".webm", "audio/webm"],
]);

let tracks = [];
let saveQueue = Promise.resolve();

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function safeTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    category: track.category,
    art: track.art,
    symbol: track.symbol,
    src: track.src,
    liked: track.liked,
    local: track.local,
  };
}

function persistTracks() {
  const snapshot = JSON.stringify(tracks, null, 2);
  saveQueue = saveQueue.then(async () => {
    const tempFile = `${LIBRARY_FILE}.${randomUUID()}.tmp`;
    await fs.writeFile(tempFile, snapshot, "utf8");
    await fs.rename(tempFile, LIBRARY_FILE);
  });
  return saveQueue;
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      const error = new Error("Upload is too large. The limit is 60 MB per request.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleUpload(request, response) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    sendJson(response, 415, { error: "Upload audio using a multipart form." });
    return;
  }

  const body = await readRequestBody(request);
  const form = await new Request("http://localhost/api/tracks", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  }).formData();
  const files = form.getAll("songs").filter((entry) => typeof entry !== "string" && entry.name);
  if (!files.length) {
    sendJson(response, 400, { error: "Choose at least one audio file to upload." });
    return;
  }

  const additions = [];
  try {
    for (const file of files) {
      const extension = path.extname(file.name).toLowerCase();
      const expectedType = audioTypes.get(extension);
      if (!expectedType || (file.type && !file.type.toLowerCase().startsWith("audio/"))) {
        throw Object.assign(new Error(`"${path.basename(file.name)}" is not a supported audio file.`), { status: 415 });
      }
      if (file.size === 0) {
        throw Object.assign(new Error(`"${path.basename(file.name)}" is empty.`), { status: 400 });
      }

      const id = randomUUID();
      const filename = `${id}${extension}`;
      const destination = path.join(UPLOAD_DIR, filename);
      await fs.writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      const title = path.basename(file.name, extension).trim() || "Untitled track";
      additions.push({
        id,
        title,
        artist: "Your music",
        album: "Local files",
        duration: "—",
        category: "All",
        art: ["amber", "blue", "pink", "lilac", "green", "rust"][(tracks.length + additions.length) % 6],
        symbol: "♫",
        src: `/uploads/${filename}`,
        liked: false,
        local: true,
      });
    }

    tracks.push(...additions);
    await persistTracks();
  } catch (error) {
    tracks = tracks.filter((track) => !additions.some((addition) => addition.id === track.id));
    await Promise.all(additions.map((track) => fs.rm(path.join(UPLOAD_DIR, path.basename(track.src)), { force: true })));
    throw error;
  }

  sendJson(response, 201, { tracks: additions.map(safeTrack) });
}

async function serveAudio(request, response, pathname) {
  const match = pathname.match(/^\/uploads\/([a-f0-9-]+\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm))$/i);
  if (!match) {
    sendJson(response, 404, { error: "Audio file not found." });
    return;
  }

  const filename = match[1];
  const filePath = path.join(UPLOAD_DIR, filename);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Audio file not found." });
      return;
    }
    throw error;
  }

  const range = request.headers.range;
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (range) {
    const matchRange = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!matchRange) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    if (matchRange[1] === "") {
      const suffixLength = Number(matchRange[2]);
      start = Math.max(0, stat.size - suffixLength);
    } else {
      start = Number(matchRange[1]);
      if (matchRange[2]) end = Number(matchRange[2]);
    }
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    status = 206;
  }

  response.writeHead(status, {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "Content-Length": end - start + 1,
    "Content-Type": audioTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
    ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = require("node:fs").createReadStream(filePath, { start, end });
  stream.on("error", (error) => {
    console.error("Audio stream failed:", error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
  stream.pipe(response);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  if (request.method === "GET" && pathname === "/api/tracks") {
    sendJson(response, 200, { tracks: tracks.map(safeTrack) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/tracks") {
    await handleUpload(request, response);
    return;
  }

  const likeMatch = pathname.match(/^\/api\/tracks\/([a-z0-9-]+)\/like$/i);
  if (request.method === "PATCH" && likeMatch) {
    const track = tracks.find((entry) => entry.id === likeMatch[1]);
    if (!track) {
      sendJson(response, 404, { error: "Track not found." });
      return;
    }
    track.liked = !track.liked;
    await persistTracks();
    sendJson(response, 200, { track: safeTrack(track) });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && pathname.startsWith("/uploads/")) {
    await serveAudio(request, response, pathname);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const files = new Map([
      ["/", ["index.html", "text/html; charset=utf-8"]],
      ["/index.html", ["index.html", "text/html; charset=utf-8"]],
      ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
      ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ]);
    const entry = files.get(pathname);
    if (!entry) {
      sendJson(response, 404, { error: "Page not found." });
      return;
    }
    const filePath = path.join(ROOT, entry[0]);
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Length": content.length,
      "Content-Type": entry[1],
    });
    response.end(request.method === "HEAD" ? undefined : content);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    const stored = JSON.parse(await fs.readFile(LIBRARY_FILE, "utf8"));
    if (!Array.isArray(stored)) throw new Error("Library data must be an array.");
    tracks = stored;
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not read the music library: ${error.message}`);
    tracks = sampleTracks;
    await persistTracks();
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error("Request failed:", error);
      if (!response.headersSent) {
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : "The server could not complete the request.",
        });
      } else {
        response.destroy(error);
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`groove is running at http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Could not start the music player server:", error);
  process.exitCode = 1;
});
