let tracks = [];
const audio = document.querySelector("#audio");
const list = document.querySelector("#track-list");
const emptyState = document.querySelector("#empty-state");
const progress = document.querySelector("#progress");
const volume = document.querySelector("#volume");
const playToggle = document.querySelector("#play-toggle");
const toast = document.querySelector("#toast");
let currentIndex = -1;
let activeFilter = "All";
let searchQuery = "";
let isShuffle = false;
let repeatMode = 0;
let toastTimeout;

document.querySelector("#date-label").textContent = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).toUpperCase();

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function loadTracks() {
  try {
    const result = await apiRequest("/api/tracks");
    tracks = result.tracks;
    renderTracks();
  } catch (error) {
    emptyState.hidden = false;
    emptyState.textContent = "Couldn't load your music library. Check that the server is running and try again.";
    showToast(error.message);
  }
}

function renderTracks() {
  const visibleTracks = tracks.map((track, index) => ({ track, index })).filter(({ track }) => {
    const matchesFilter = activeFilter === "All" || (activeFilter === "Liked songs" ? track.liked : track.category === activeFilter);
    const searchText = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
    return matchesFilter && searchText.includes(searchQuery);
  });

  list.innerHTML = visibleTracks.map(({ track, index }) => {
    const current = index === currentIndex;
    const playing = current && !audio.paused;
    return `
      <article class="track-row${current ? " current" : ""}" data-index="${index}">
        <div class="track-index">
          <span class="track-number">${current && !audio.paused ? "♫" : String(index + 1).padStart(2, "0")}</span>
          <button class="row-play${playing ? " playing" : ""}" data-action="play" data-index="${index}" aria-label="${playing ? "Pause" : "Play"} ${escapeHtml(track.title)}">${icon(playing ? "pause" : "play")}</button>
        </div>
        <div class="track-info">
          <div class="track-art cover-${track.art}"><span>${track.symbol}</span></div>
          <div class="track-copy"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span></div>
        </div>
        <span class="track-album">${escapeHtml(track.album)}</span>
        <span class="track-duration">${track.duration}</span>
        <button class="icon-button track-like${track.liked ? " liked" : ""}" data-action="like" data-index="${index}" aria-label="${track.liked ? "Unlike" : "Like"} ${escapeHtml(track.title)}">${icon("heart")}</button>
      </article>
    `;
  }).join("");
  emptyState.hidden = visibleTracks.length > 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function updatePlayButton() {
  const playing = !audio.paused;
  playToggle.innerHTML = icon(playing ? "pause" : "play");
  playToggle.setAttribute("aria-label", playing ? "Pause" : "Play");
  renderTracks();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function updateProgress() {
  const duration = audio.duration || 0;
  const percent = duration ? (audio.currentTime / duration) * 100 : 0;
  progress.value = String(percent);
  progress.style.setProperty("--progress", `${percent}%`);
  document.querySelector("#elapsed").textContent = formatTime(audio.currentTime);
  document.querySelector("#duration").textContent = formatTime(duration);
}

function playTrack(index) {
  if (!tracks[index]) return;
  currentIndex = index;
  const track = tracks[index];
  audio.src = track.src;
  audio.load();
  document.querySelector("#now-title").textContent = track.title;
  document.querySelector("#now-artist").textContent = track.artist;
  const cover = document.querySelector("#now-cover");
  cover.className = `now-cover cover-${track.art}`;
  cover.innerHTML = `<span>${track.symbol}</span>`;
  document.querySelector("#like-current").classList.toggle("liked", Boolean(track.liked));
  updateProgress();
  renderTracks();
  audio.play().catch(() => showToast("Couldn't play this preview. Try uploading a music file."));
}

function togglePlayback() {
  if (currentIndex < 0) {
    playTrack(0);
  } else if (audio.paused) {
    audio.play().catch(() => showToast("Couldn't play this preview. Try uploading a music file."));
  } else {
    audio.pause();
  }
}

function nextTrack(direction = 1) {
  if (!tracks.length) return;
  if (isShuffle && direction > 0 && tracks.length > 1) {
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * tracks.length);
    playTrack(next);
    return;
  }
  const next = currentIndex < 0 ? 0 : (currentIndex + direction + tracks.length) % tracks.length;
  playTrack(next);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function toggleLike(index) {
  const track = tracks[index];
  if (!track) return;
  try {
    const result = await apiRequest(`/api/tracks/${encodeURIComponent(track.id)}/like`, { method: "PATCH" });
    track.liked = result.track.liked;
    renderTracks();
    if (index === currentIndex) document.querySelector("#like-current").classList.toggle("liked", track.liked);
    showToast(track.liked ? "Added to your liked songs" : "Removed from your liked songs");
  } catch (error) {
    showToast(error.message);
  }
}

list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === "play") {
    if (index === currentIndex && !audio.paused) audio.pause();
    else playTrack(index);
  } else if (button.dataset.action === "like") {
    toggleLike(index);
  }
});

document.querySelector("#play-toggle").addEventListener("click", togglePlayback);
document.querySelector("#feature-play").addEventListener("click", () => playTrack(0));
document.querySelectorAll(".quick-pick").forEach((button) => button.addEventListener("click", () => playTrack(Number(button.dataset.playIndex))));
document.querySelector("#next").addEventListener("click", () => nextTrack(1));
document.querySelector("#previous").addEventListener("click", () => {
  if (audio.currentTime > 3) audio.currentTime = 0;
  else nextTrack(-1);
});
document.querySelector("#shuffle").addEventListener("click", (event) => {
  isShuffle = !isShuffle;
  event.currentTarget.classList.toggle("enabled", isShuffle);
  showToast(isShuffle ? "Shuffle is on" : "Shuffle is off");
});
document.querySelector("#repeat").addEventListener("click", (event) => {
  repeatMode = (repeatMode + 1) % 3;
  event.currentTarget.classList.toggle("enabled", repeatMode !== 0);
  event.currentTarget.classList.toggle("repeat-one", repeatMode === 2);
  showToast(["Repeat is off", "Repeating the queue", "Repeating this track"][repeatMode]);
});
document.querySelector("#like-current").addEventListener("click", () => {
  if (currentIndex >= 0) toggleLike(currentIndex);
  else showToast("Choose a track first");
});

document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("selected", chip === button));
  renderTracks();
}));
document.querySelectorAll(".playlist-link").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("selected", chip.dataset.filter === activeFilter));
  renderTracks();
  document.querySelector("#track-heading").innerHTML = `${escapeHtml(button.textContent.trim())} <span>✳</span>`;
}));
document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link === button));
  if (button.dataset.view === "Liked songs") {
    activeFilter = "Liked songs";
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.remove("selected"));
    document.querySelector("#track-heading").innerHTML = 'Your liked songs <span>♥</span>';
  } else {
    activeFilter = "All";
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("selected", chip.dataset.filter === "All"));
    document.querySelector("#track-heading").innerHTML = `${button.dataset.view === "Home" ? "Made for this moment" : `${escapeHtml(button.dataset.view)} for you`} <span>✳</span>`;
  }
  renderTracks();
}));

document.querySelector("#search").addEventListener("input", (event) => {
  searchQuery = event.target.value.trim().toLowerCase();
  renderTracks();
});
document.querySelector("#see-all").addEventListener("click", () => {
  activeFilter = "All";
  searchQuery = "";
  document.querySelector("#search").value = "";
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("selected", chip.dataset.filter === "All"));
  renderTracks();
});
document.querySelector("#add-playlist").addEventListener("click", () => showToast("Your playlist is ready for a name"));
document.querySelector("#sidebar-upload").addEventListener("click", () => document.querySelector("#file-input").click());
document.querySelector("#top-upload").addEventListener("click", () => document.querySelector("#file-input").click());

document.querySelector("#file-input").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  const form = new FormData();
  files.forEach((file) => form.append("songs", file));
  const uploadButton = document.querySelector("#top-upload");
  uploadButton.disabled = true;
  try {
    const result = await apiRequest("/api/tracks", { method: "POST", body: form });
    const firstNewIndex = tracks.length;
    tracks.push(...result.tracks);
    activeFilter = "All";
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("selected", chip.dataset.filter === "All"));
    renderTracks();
    playTrack(firstNewIndex);
    showToast(`${result.tracks.length} ${result.tracks.length === 1 ? "track" : "tracks"} added to your library`);
  } catch (error) {
    showToast(error.message);
  } finally {
    uploadButton.disabled = false;
    event.target.value = "";
  }
});

progress.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = (Number(progress.value) / 100) * audio.duration;
  updateProgress();
});
volume.addEventListener("input", () => {
  audio.volume = Number(volume.value);
  volume.style.setProperty("--volume", `${Number(volume.value) * 100}%`);
});
audio.volume = Number(volume.value);
audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("loadedmetadata", updateProgress);
audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);
audio.addEventListener("ended", () => {
  if (repeatMode === 2) {
    audio.currentTime = 0;
    audio.play().catch(() => showToast("Couldn't replay this preview."));
  } else if (repeatMode === 1 || currentIndex < tracks.length - 1 || isShuffle) {
    nextTrack(1);
  } else {
    updatePlayButton();
  }
});
audio.addEventListener("error", () => {
  if (currentIndex >= 0) showToast("Preview unavailable. Upload a music file to listen.");
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#search").focus();
  } else if (event.code === "Space" && !["INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)) {
    event.preventDefault();
    togglePlayback();
  }
});

loadTracks();
