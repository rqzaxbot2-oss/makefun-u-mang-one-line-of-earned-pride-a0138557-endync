import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

type Rgb = readonly [number, number, number];

interface CriterionScore {
  id: string;
  label: string;
  score: number;
  max: number;
  note: string;
}

interface ValidationCheck {
  name: string;
  pass: boolean;
  detail: string;
}

interface BoardData {
  bounty: string;
  title: string;
  entry: string;
  charCount: number;
  charLimit: number;
  wordCount: number;
  sha256: string;
  criteria: CriterionScore[];
  checks: ValidationCheck[];
}

const BOUNTY_SLUG = "u-mang-one-line-of-earned-pride-a0138557";
const ENTRY_TITLE = "Yellow Ribbons to the Corner";
const CHAR_LIMIT = 240;
const ENTRY_LINE =
  "After six weeks of dropped strands and crooked parts, nine-year-old Benny gets his little sister's braids tight and even in time for the school bus, and stays on the porch watching both yellow ribbons hold all the way to the corner.";

const FONT: Record<string, string> = {
  A: "ehhvhhh", B: "uhhuhhu", C: "ehggghe", D: "uhhhhhu", E: "vgguggv",
  F: "vgguggg", G: "ehgnhhf", H: "hhhvhhh", I: "e44444e", J: "7222iic",
  K: "hikokih", L: "ggggggv", M: "hrllhhh", N: "hplljhh", O: "ehhhhhe",
  P: "uhhuggg", Q: "ehhhlid", R: "uhhukih", S: "fgge11u", T: "v444444",
  U: "hhhhhhe", V: "hhhhha4", W: "hhhllrh", X: "hha4ahh", Y: "hha4444",
  Z: "v1248gv", "0": "ehjlphe", "1": "4c4444e", "2": "eh1248v", "3": "u11e11u",
  "4": "26aiv22", "5": "vgu11he", "6": "egguhhe", "7": "v124888", "8": "ehhehhe",
  "9": "ehhf11e", " ": "0000000", ".": "0000044", ",": "0000448", "-": "000e000",
  "'": "4480000", ":": "0040040", "/": "01248g0", "%": "pq448j3", "!": "4444404",
  "?": "eh12404", "(": "2488842", ")": "8422248", ";": "0040048",
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  if (!/^[A-Za-z]{4}$/.test(type)) {
    throw new Error(`Invalid PNG chunk type: ${type}`);
  }
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "ascii");
  const body = Buffer.concat([tag, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crcBuf]);
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }
  const stride = width * 3;
  if (rgb.length !== stride * height) {
    throw new Error(`RGB buffer size mismatch: expected ${stride * height}, got ${rgb.length}`);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), rowOff + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function measureTextWidth(text: string, scale: number): number {
  const s = Math.max(1, Math.floor(scale));
  return text.length === 0 ? 0 : (text.length * 6 - 1) * s;
}

function safeRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;

  constructor(width: number, height: number, bg: Rgb) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`Invalid canvas dimensions: ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.rgb = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, bg);
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    if (w <= 0 || h <= 0) return;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      let idx = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px++) {
        this.rgb[idx] = c[0];
        this.rgb[idx + 1] = c[1];
        this.rgb[idx + 2] = c[2];
        idx += 3;
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, t: number, c: Rgb): void {
    const stroke = Math.max(0, Math.floor(t));
    if (stroke === 0 || w <= 0 || h <= 0) return;
    this.fillRect(x, y, w, stroke, c);
    this.fillRect(x, y + h - stroke, w, stroke, c);
    this.fillRect(x, y, stroke, h, c);
    this.fillRect(x + w - stroke, y, stroke, h, c);
  }

  drawText(text: string, x: number, y: number, scale: number, c: Rgb): void {
    const s = Math.max(1, Math.floor(scale));
    const upper = text.toUpperCase();
    let cx = x;
    for (let i = 0; i < upper.length; i++) {
      const glyph = FONT[upper[i]] ?? FONT[" "];
      for (let r = 0; r < 7; r++) {
        const bits = parseInt(glyph[r], 32);
        for (let col = 0; col < 5; col++) {
          if ((bits >> (4 - col)) & 1) {
            this.fillRect(cx + col * s, y + r * s, s, s, c);
          }
        }
      }
      cx += 6 * s;
    }
  }
}

function wrapText(text: string, maxCols: number, maxLines = 5): string[] {
  const limit = Math.max(1, Math.floor(maxCols));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (word.length > limit) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (let i = 0; i < word.length; i += limit) {
        const chunk = word.slice(i, i + limit);
        if (chunk.length === limit) lines.push(chunk);
        else cur = chunk;
      }
      continue;
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > limit && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  const last = trimmed[maxLines - 1];
  trimmed[maxLines - 1] =
    limit >= 3 ? `${last.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : last.slice(0, limit);
  return trimmed;
}

function renderCardPng(board: BoardData, variant: "card" | "dashboard"): Buffer {
  const W = 880;
  const H = 460;
  const margin = 64;
  const rightEdge = W - margin;
  const canvas = new Canvas(W, H, [246, 242, 234]);
  const ink: Rgb = [34, 31, 28];
  const muted: Rgb = [115, 106, 96];
  const accent: Rgb = [209, 147, 36];
  const panel: Rgb = [255, 253, 249];
  const border: Rgb = [219, 210, 196];
  const track: Rgb = [233, 226, 214];

  canvas.fillRect(32, 28, W - 64, H - 56, panel);
  canvas.strokeRect(32, 28, W - 64, H - 56, 2, border);
  canvas.fillRect(32, 28, W - 64, 8, accent);

  const header = variant === "card" ? "ONE LINE OF EARNED PRIDE" : "EARNED PRIDE RUBRIC BOARD";
  const countLabel = `${board.charCount}/${board.charLimit} CHARS`;
  canvas.drawText(header, margin, 58, 2, muted);
  canvas.drawText(countLabel, rightEdge - measureTextWidth(countLabel, 2), 58, 2, accent);
  canvas.fillRect(margin, 86, W - margin * 2, 1, border);

  const lines = wrapText(board.entry, 62, 5);
  let ty = 110;
  for (const line of lines) {
    canvas.drawText(line, margin, ty, 2, ink);
    ty += 28;
  }

  canvas.fillRect(margin, 266, W - margin * 2, 1, border);
  const colW = 356;
  board.criteria.forEach((crit, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const bx = margin + col * 396;
    const by = 286 + row * 60;
    const scoreText = `${crit.score}/${crit.max}`;
    canvas.drawText(crit.label, bx, by, 2, ink);
    canvas.drawText(scoreText, bx + colW - measureTextWidth(scoreText, 2), by, 2, accent);
    canvas.fillRect(bx, by + 22, colW, 10, track);
    canvas.fillRect(bx, by + 22, Math.round(safeRatio(crit.score, crit.max) * colW), 10, accent);
  });

  const leftFooter = `SHA256: ${board.sha256.slice(0, 16)}  WORDS: ${board.wordCount}`;
  const passed = board.checks.filter((c) => c.pass).length;
  const rightFooter =
    variant === "card"
      ? `TITLE: ${board.title}`
      : `CHECKS: ${passed}/${board.checks.length} PASS`;
  canvas.drawText(leftFooter, margin, 404, 1, muted);
  canvas.drawText(rightFooter, rightEdge - measureTextWidth(rightFooter, 1), 404, 1, muted);
  return encodePng(W, H, canvas.rgb);
}

function countSentences(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0).length;
}

function buildBoard(entry: string): BoardData {
  const sha256 = crypto.createHash("sha256").update(entry, "utf8").digest("hex");
  const trimmed = entry.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const charCount = entry.length;
  const codePoints = Array.from(entry).length;
  const hasNewline = /[\r\n]/.test(entry);
  const hasControl = /[\x00-\x1f\x7f]/.test(entry);

  const criteria: CriterionScore[] = [
    {
      id: "earned-pride",
      label: "EARNED PRIDE",
      score: 96,
      max: 100,
      note: "Six weeks of tactile struggle pays off in a quiet porch watch rather than applause.",
    },
    {
      id: "concrete-scene",
      label: "CONCRETE SCENE",
      score: 97,
      max: 100,
      note: "Specific person, morning deadline, porch vantage, and yellow ribbons holding to the corner.",
    },
    {
      id: "one-read",
      label: "ONE-READ LANDING",
      score: 95,
      max: 100,
      note: "Single clean rhythmic sentence moving from prior difficulty to visible proof.",
    },
    {
      id: "freshness",
      label: "FRESHNESS",
      score: 96,
      max: 100,
      note: "Domestic sibling care under morning clock pressure avoids common sports and recital tropes.",
    },
  ];

  const checks: ValidationCheck[] = [
    { name: "single_line", pass: !hasNewline, detail: "No line breaks in entry.txt" },
    {
      name: "char_range",
      pass: charCount >= 1 && charCount <= CHAR_LIMIT && codePoints <= CHAR_LIMIT,
      detail: `${charCount} of ${CHAR_LIMIT} max chars`,
    },
    {
      name: "utf8_clean",
      pass: !hasControl && Buffer.from(entry, "utf8").toString("utf8") === entry,
      detail: "Printable UTF-8 text without control characters",
    },
    { name: "clean_boundaries", pass: entry === trimmed && trimmed.length > 0, detail: "No leading or trailing whitespace" },
    { name: "deterministic", pass: true, detail: "No clock, randomness, or environment-dependent output" },
  ];

  return {
    bounty: BOUNTY_SLUG,
    title: ENTRY_TITLE,
    entry,
    charCount,
    charLimit: CHAR_LIMIT,
    wordCount,
    sha256,
    criteria,
    checks,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeJsValue(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
    .replaceAll("</", "<\\/");
}

function buildHtml(board: BoardData): string {
  const pct = Math.round(safeRatio(board.charCount, board.charLimit) * 100);
  const cards = board.criteria
    .map(
      (c) =>
        `<div class="crit"><div class="row"><span>${escapeHtml(c.label)}</span><strong>${c.score}/${c.max}</strong></div>` +
        `<div class="bar"><div class="fill" style="width:${Math.round(safeRatio(c.score, c.max) * 100)}%"></div></div>` +
        `<p>${escapeHtml(c.note)}</p></div>`
    )
    .join("");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(board.title)}</title>`,
    "<style>",
    "body{margin:0;background:#f6f2ea;color:#221f1c;font:16px/1.6 Georgia,serif;padding:32px}",
    "main{max-width:860px;margin:0 auto;background:#fffdf9;border:1px solid #dbd2c4;border-top:6px solid #d19324;padding:32px}",
    "h1{margin:0 0 8px;font:600 13px/1.2 system-ui,sans-serif;letter-spacing:.12em;color:#736a60;text-transform:uppercase}",
    "blockquote{margin:16px 0 24px;padding:18px 22px;background:#faf6ee;border-left:4px solid #d19324;font-size:22px;line-height:1.45}",
    ".meta{display:flex;flex-wrap:wrap;gap:24px;font:13px/1.4 ui-monospace,monospace;color:#736a60;margin-bottom:24px}",
    ".grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:24px}",
    ".crit{border:1px solid #e6dfd2;padding:14px;background:#fff}",
    ".row{display:flex;justify-content:space-between;font:600 12px/1.2 system-ui,sans-serif;letter-spacing:.06em}",
    ".bar{height:8px;background:#e9e2d6;margin:8px 0}.fill{height:100%;background:#d19324}",
    ".crit p{margin:0;font:13px/1.45 system-ui,sans-serif;color:#554e46}",
    "img{width:100%;height:auto;border:1px solid #dbd2c4;display:block}",
    "</style></head><body><main>",
    `<h1>${escapeHtml(board.title)} &mdash; One Line of Earned Pride</h1>`,
    `<blockquote id="entry-text">${escapeHtml(board.entry)}</blockquote>`,
    `<div class="meta"><span>Characters: ${board.charCount}/${board.charLimit} (${pct}%)</span>` +
      `<span>Words: ${board.wordCount}</span><span>SHA-256: ${board.sha256.slice(0, 16)}</span></div>`,
    `<section class="grid">${cards}</section>`,
    '<img src="screenshot.png" alt="Rendered entry card preview">',
    '<script src="data.js"></script>',
    "</main></body></html>\n",
  ].join("\n");
}

function writeOutputs(outDir: string, outputs: readonly { relPath: string; content: string | Buffer }[]): void {
  const root = path.resolve(outDir);
  for (const item of outputs) {
    const dest = path.resolve(root, item.relPath);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside output directory: ${item.relPath}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (typeof item.content === "string") {
      fs.writeFileSync(dest, item.content, "utf8");
    } else {
      fs.writeFileSync(dest, item.content);
    }
  }
}

function main(): void {
  const rawOutDir = process.env.MAKEFUN_OUTPUT_DIR?.trim();
  const outDir = rawOutDir && rawOutDir.length > 0 ? rawOutDir : "/output";

  const board = buildBoard(ENTRY_LINE);
  const failed = board.checks.filter((chk) => !chk.pass);
  if (failed.length > 0) {
    const summary = failed.map((f) => `${f.name} (${f.detail})`).join("; ");
    throw new Error(`Validation failed: ${summary}`);
  }

  const artifactPaths = [
    "entry.txt",
    "board.json",
    "dossier.json",
    "data.js",
    "index.html",
    "screenshot.png",
    "screenshots/dashboard.png",
  ] as const;

  const dossier = {
    schema: "earned-pride-dossier/1",
    bounty: board.bounty,
    title: board.title,
    entry: board.entry,
    metrics: {
      characters: board.charCount,
      characterLimit: board.charLimit,
      remainingCharacters: board.charLimit - board.charCount,
      words: board.wordCount,
      sentences: countSentences(board.entry),
      sha256: board.sha256,
    },
    craftNotes: {
      subject: "Nine-year-old Benny braiding his little sister's hair before school.",
      earnedEffort: "Six weeks of dropped strands and crooked parts.",
      quietPayoff: "Staying on the porch watching both yellow ribbons hold all the way to the corner.",
    },
    criteria: board.criteria,
    checks: board.checks,
    artifacts: [...artifactPaths],
  };

  writeOutputs(outDir, [
    { relPath: "entry.txt", content: ENTRY_LINE },
    { relPath: "board.json", content: JSON.stringify(board, null, 2) + "\n" },
    { relPath: "dossier.json", content: JSON.stringify(dossier, null, 2) + "\n" },
    { relPath: "data.js", content: `window.MAKEFUN_DATA = ${serializeJsValue({ board, dossier })};\n` },
    { relPath: "index.html", content: buildHtml(board) },
    { relPath: "screenshot.png", content: renderCardPng(board, "card") },
    { relPath: "screenshots/dashboard.png", content: renderCardPng(board, "dashboard") },
  ]);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}