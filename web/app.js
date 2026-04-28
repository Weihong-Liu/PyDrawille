// =============================================================================
// Image2Braille - 客户端纯 JS 实现
// 把图片转成 Unicode 盲文点阵 (U+2800 - U+28FF)
// 算法逻辑对应 Python 端 image_to_braille.py / PyDrawille.CanvasSurface.dump
// =============================================================================

const DENSITY_RAMP = "⠀⢀⢠⢰⢸⣸⣼⣾⣿"; // popcount 0..8

const PRESETS = {
  bronze: ["#CD7F32", "#FFBF00", "#FFD700", "#FFBF00", "#CD7F32", "#B8860B"],
  fire: ["#3B0000", "#9F1B0F", "#F26522", "#FFD23F", "#FFF8C6"],
  ocean: ["#001F3F", "#0074D9", "#39CCCC", "#7FDBFF"],
  mono: ["#FFFFFF"],
};

// 子像素 -> Unicode braille bit
// 视觉布局 (col, row):
//   (0,0) (1,0)        dots: 1 4
//   (0,1) (1,1)              2 5
//   (0,2) (1,2)              3 6
//   (0,3) (1,3)              7 8
// dot N -> bit (N-1) 即 1->0, 2->1, 3->2, 4->3, 5->4, 6->5, 7->6, 8->7
const BRAILLE_BITS = [
  [0, 3], // row 0
  [1, 4], // row 1
  [2, 5], // row 2
  [6, 7], // row 3
];

// =============================================================================
// 图像处理
// =============================================================================

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

function imageToGray(img, w, h, invert) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 透明 PNG 默认在白底上合成,避免黑色 fringe
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (invert) gray = 255 - gray;
    out[j] = gray;
  }
  return out;
}

function floydSteinberg(gray, w, h) {
  const buf = new Float32Array(gray);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const newPix = old < 128 ? 0 : 255;
      out[i] = newPix === 255 ? 1 : 0;
      const err = old - newPix;
      if (x + 1 < w) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) buf[i + w - 1] += (err * 3) / 16;
        buf[i + w] += (err * 5) / 16;
        if (x + 1 < w) buf[i + w + 1] += (err * 1) / 16;
      }
    }
  }
  return out;
}

function thresholdBinarize(gray, threshold) {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = gray[i] > threshold ? 1 : 0;
  }
  return out;
}

// =============================================================================
// subpixel 模式: 每字符 = 2x4 二值子像素
// =============================================================================

function brailleSubpixel(img, opts) {
  const { cols, threshold, invert } = opts;
  const W = cols * 2;
  const H = Math.max(4, Math.round((W * img.height) / img.width / 4) * 4);
  const gray = imageToGray(img, W, H, invert);
  const bw =
    threshold == null
      ? floydSteinberg(gray, W, H)
      : thresholdBinarize(gray, threshold);

  const lines = [];
  for (let cy = 0; cy < H / 4; cy++) {
    let line = "";
    for (let cx = 0; cx < W / 2; cx++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (bw[(cy * 4 + dy) * W + (cx * 2 + dx)]) {
            bits |= 1 << BRAILLE_BITS[dy][dx];
          }
        }
      }
      line += String.fromCodePoint(0x2800 + bits);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// =============================================================================
// density 模式: 1 字符 1 像素,亮度选 ramp
// =============================================================================

function brailleDensity(img, opts) {
  const { cols, invert } = opts;
  // 终端字符大致 1 宽 2 高 -> 行数除以 2 才不变形
  const rows = Math.max(1, Math.round((cols * img.height) / img.width / 2));
  const gray = imageToGray(img, cols, rows, invert);
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const v = Math.min(8, Math.floor((gray[y * cols + x] * 9) / 256));
      line += DENSITY_RAMP[v];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// =============================================================================
// 颜色渐变
// =============================================================================

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]) {
  return (
    "#" +
    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

function interpolateColors(stops, n) {
  if (!stops.length) return [];
  if (stops.length === 1 || n === 1) return Array(n).fill(stops[0]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i * (stops.length - 1)) / (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = t - lo;
    const c1 = stops[lo],
      c2 = stops[hi];
    out.push([
      Math.round(c1[0] * (1 - f) + c2[0] * f),
      Math.round(c1[1] * (1 - f) + c2[1] * f),
      Math.round(c1[2] * (1 - f) + c2[2] * f),
    ]);
  }
  return out;
}

function escapeHtml(s) {
  return s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
}

function buildRenderedHtml(text, colorStops) {
  const lines = text.split("\n");
  if (!colorStops.length) {
    return lines.map(escapeHtml).join("\n");
  }
  const colors = interpolateColors(colorStops, lines.length);
  return lines
    .map(
      (line, i) =>
        `<span style="color:${rgbToHex(colors[i])}">${escapeHtml(line)}</span>`
    )
    .join("\n");
}

function buildTaggedText(text, colorStops) {
  const lines = text.split("\n");
  if (!colorStops.length) return text;
  const colors = interpolateColors(colorStops, lines.length);
  return lines.map((line, i) => `[${rgbToHex(colors[i])}]${line}[/]`).join("\n");
}

// =============================================================================
// UI 状态与事件
// =============================================================================

const $ = (id) => document.getElementById(id);

const state = {
  img: null,
  preset: "bronze",
  lastText: "",
  lastTagged: "",
};

function updateThresholdRow() {
  const useThreshold = $("binarize").value === "threshold";
  $("threshold-row").style.display = useThreshold ? "" : "none";
}

function getSettings() {
  return {
    cols: parseInt($("cols").value, 10),
    mode: $("mode").value,
    threshold:
      $("binarize").value === "threshold"
        ? parseInt($("threshold").value, 10)
        : null,
    invert: $("invert").checked,
  };
}

function getColorStops() {
  const custom = $("custom-colors").value.trim();
  if (custom) {
    const parsed = custom
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^#?[0-9a-fA-F]{6}$/.test(s))
      .map((s) => hexToRgb(s.startsWith("#") ? s : "#" + s));
    if (parsed.length) return parsed;
  }
  return PRESETS[state.preset].map(hexToRgb);
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 60);
}

function render() {
  if (!state.img) return;
  const settings = getSettings();
  const t0 = performance.now();
  const text =
    settings.mode === "density"
      ? brailleDensity(state.img, settings)
      : brailleSubpixel(state.img, settings);
  const dt = performance.now() - t0;

  const stops = getColorStops();
  $("rendered").innerHTML = buildRenderedHtml(text, stops);
  $("raw").textContent = buildTaggedText(text, stops);

  state.lastText = text;
  state.lastTagged = $("raw").textContent;

  const lines = text.split("\n");
  const charsPerLine = lines[0] ? [...lines[0]].length : 0;
  $(
    "status"
  ).textContent = `${lines.length} 行 × ${charsPerLine} 字 · ${settings.mode} · ${dt.toFixed(0)} ms`;
  $("placeholder").classList.add("hidden");
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    flashStatus("请选择图片文件", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      state.img = await loadImage(e.target.result);
      render();
    } catch (err) {
      flashStatus(err.message, true);
    }
  };
  reader.readAsDataURL(file);
}

async function loadSample(src) {
  try {
    state.img = await loadImage(src);
    render();
  } catch (err) {
    flashStatus(`样图载入失败: ${err.message}`, true);
  }
}

function switchTab(tab) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("rendered").hidden = tab !== "rendered";
  $("raw").hidden = tab !== "raw";
}

function flashStatus(msg, isError) {
  const status = $("status");
  const orig = status.textContent;
  status.textContent = msg;
  status.classList.add("flash");
  if (isError) status.style.color = "#ff6b6b";
  setTimeout(() => {
    status.textContent = orig;
    status.classList.remove("flash");
    status.style.color = "";
  }, 1600);
}

function getActiveOutputText() {
  const tab = document.querySelector(".tab.active").dataset.tab;
  return tab === "raw" ? state.lastTagged : state.lastText;
}

function init() {
  // 文件上传
  const dz = $("dropzone");
  const fi = $("file-input");
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  // 样图
  document.querySelectorAll(".sample").forEach((b) => {
    b.addEventListener("click", () => loadSample(b.dataset.src));
  });

  // 设置控件
  ["cols", "mode", "threshold", "invert", "binarize", "custom-colors"].forEach(
    (id) => {
      const el = $(id);
      const evt = el.type === "range" || el.type === "text" ? "input" : "change";
      el.addEventListener(evt, () => {
        if (id === "cols") $("cols-val").textContent = $("cols").value;
        if (id === "threshold") $("threshold-val").textContent = $("threshold").value;
        if (id === "binarize") updateThresholdRow();
        scheduleRender();
      });
    }
  );

  // 预设
  document.querySelectorAll(".preset").forEach((b) => {
    b.addEventListener("click", () => {
      state.preset = b.dataset.preset;
      document
        .querySelectorAll(".preset")
        .forEach((x) => x.classList.toggle("active", x === b));
      scheduleRender();
    });
  });

  // tabs
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });

  // 复制
  $("copy-btn").addEventListener("click", async () => {
    const text = getActiveOutputText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashStatus("已复制到剪贴板");
    } catch {
      flashStatus("复制失败 - 浏览器不允许", true);
    }
  });

  // 下载
  $("download-btn").addEventListener("click", () => {
    const text = getActiveOutputText();
    if (!text) return;
    const tab = document.querySelector(".tab.active").dataset.tab;
    const suffix = tab === "raw" ? "tagged" : "plain";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `braille-${suffix}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    flashStatus(`已下载 ${a.download}`);
  });

  // 初始化
  updateThresholdRow();
  loadSample("samples/wheel.png");
}

document.addEventListener("DOMContentLoaded", init);
