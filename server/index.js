require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const Groq = require("groq-sdk");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const model = "llama-3.3-70b-versatile";
const visionModel = "llama-3.2-90b-vision-preview";

// ── Multer (file uploads) ──────────────────────────────────────────────────
const { memoryStorage } = multer;
const upload = multer({ storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── In-memory stores ───────────────────────────────────────────────────────
let reminders = [];
const uploadedFiles = {}; // fileId -> { name, text, mimeType, uploadedAt }

// ── SQLite DB (ToolController) ─────────────────────────────────────────────
const Database = require("better-sqlite3");
const DB_PATH = path.join(__dirname, "tools.db");
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, status TEXT DEFAULT 'pending', created_at TEXT);
  INSERT OR IGNORE INTO notes (id, title, content, created_at) VALUES (1,'Welcome','This is a sample note.', datetime('now'));
  INSERT OR IGNORE INTO tasks (id, task, status, created_at) VALUES (1,'Buy groceries','pending', datetime('now'));
`);

function dbQuery(query, params = {}) {
  try {
    const stmt = db.prepare(query);
    if (query.trim().toUpperCase().startsWith("SELECT")) {
      const rows = stmt.all(params);
      return JSON.stringify(rows);
    } else {
      const info = stmt.run(params);
      return JSON.stringify({ changes: info.changes, lastInsertRowid: info.lastInsertRowid });
    }
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

// ── Tool Functions ─────────────────────────────────────────────────────────
function getCurrentDatetime() {
  return new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function addDurationToDatetime(datetime_str, duration = 0, unit = "days") {
  const date = new Date(datetime_str);
  const ms = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
  let result;
  if (ms[unit]) result = new Date(date.getTime() + duration * ms[unit]);
  else if (unit === "months") { result = new Date(date); result.setMonth(result.getMonth() + duration); }
  else if (unit === "years") { result = new Date(date); result.setFullYear(result.getFullYear() + duration); }
  else result = date;
  return result.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function setReminder(content, timestamp) {
  const reminder = { _id: String(Date.now()), content, timestamp };
  reminders.push(reminder);
  return `Reminder saved: "${content}" at ${timestamp}`;
}

async function getLivePrice(symbol) {
  const sym = symbol.toUpperCase().trim();
  const metalMap = { GOLD: "gold", SILVER: "silver", PLATINUM: "platinum", PALLADIUM: "palladium" };
  if (metalMap[sym]) {
    try {
      const r = await fetch(`https://api.metals.live/v1/spot/${metalMap[sym]}`);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]) {
          const price = Object.values(d[0])[0];
          return `${sym} current spot price: $${price} USD per troy ounce (live)`;
        }
      }
    } catch {}
  }
  const cryptoMap = { BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", MATIC: "matic-network", AVAX: "avalanche-2", LTC: "litecoin", LINK: "chainlink", DOT: "polkadot" };
  const coinId = cryptoMap[sym] || sym.toLowerCase();
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
    if (r.ok) {
      const d = await r.json();
      if (d[coinId]) return `${sym} price: $${d[coinId].usd} USD (24h: ${d[coinId].usd_24h_change?.toFixed(2)}%)`;
    }
  } catch {}
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) {
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        const prev = meta.chartPreviousClose || meta.previousClose;
        const change = prev ? (((meta.regularMarketPrice - prev) / prev) * 100).toFixed(2) : "N/A";
        return `${sym} price: $${meta.regularMarketPrice} USD (24h: ${change}%, exchange: ${meta.exchangeName || "N/A"})`;
      }
    }
  } catch {}
  return `Could not fetch live price for ${sym}.`;
}

// ── Text Editor ────────────────────────────────────────────────────────────
const BASE_DIR = path.resolve(__dirname);
const BACKUP_DIR = path.join(BASE_DIR, ".backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function validatePath(filePath) {
  const abs = path.resolve(BASE_DIR, filePath);
  if (!abs.startsWith(BASE_DIR + path.sep) && abs !== BASE_DIR) throw new Error(`Access denied`);
  return abs;
}
function backupFile(absPath) {
  if (!fs.existsSync(absPath)) return;
  const name = path.basename(absPath);
  const mtime = fs.statSync(absPath).mtimeMs;
  fs.copyFileSync(absPath, path.join(BACKUP_DIR, `${name}.${Math.floor(mtime)}`));
}
function editorRun(command, input) {
  const abs = validatePath(input.path);
  if (command === "view") {
    if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).join("\n");
    const lines = fs.readFileSync(abs, "utf-8").split("\n");
    const [s, e] = input.view_range ? [input.view_range[0] - 1, input.view_range[1] === -1 ? lines.length : input.view_range[1]] : [0, lines.length];
    return lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join("\n");
  }
  if (command === "create") {
    if (fs.existsSync(abs)) throw new Error("File already exists.");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, input.file_text, "utf-8");
    return `Created ${input.path}`;
  }
  if (command === "str_replace") {
    const content = fs.readFileSync(abs, "utf-8");
    const count = content.split(input.old_str).length - 1;
    if (count === 0) throw new Error("No match found.");
    if (count > 1) throw new Error(`Found ${count} matches — be more specific.`);
    backupFile(abs);
    fs.writeFileSync(abs, content.replace(input.old_str, input.new_str), "utf-8");
    return "Replaced successfully.";
  }
  if (command === "insert") {
    backupFile(abs);
    const lines = fs.readFileSync(abs, "utf-8").split("\n");
    lines.splice(input.insert_line, 0, input.new_str);
    fs.writeFileSync(abs, lines.join("\n"), "utf-8");
    return `Inserted at line ${input.insert_line}`;
  }
  if (command === "undo_edit") {
    const name = path.basename(abs);
    const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(name + ".")).sort().reverse();
    if (!backups.length) throw new Error("No backups found.");
    fs.copyFileSync(path.join(BACKUP_DIR, backups[0]), abs);
    return `Restored ${input.path}`;
  }
  throw new Error(`Unknown command: ${command}`);
}

// ── BM25 + Vector Hybrid RAG ───────────────────────────────────────────────
class BM25Index {
  constructor() { this.docs = []; this.tokens = []; this.lens = []; this.freqs = {}; this.idf = {}; this.avgLen = 0; this.built = false; this.k1 = 1.5; this.b = 0.75; }
  _tok(t) { return t.toLowerCase().split(/\W+/).filter(Boolean); }
  add(doc) {
    const toks = this._tok(doc.text);
    this.docs.push(doc); this.tokens.push(toks); this.lens.push(toks.length);
    const seen = new Set();
    for (const t of toks) { if (!seen.has(t)) { this.freqs[t] = (this.freqs[t] || 0) + 1; seen.add(t); } }
    this.built = false;
  }
  _build() {
    const N = this.docs.length;
    this.avgLen = this.lens.reduce((a, b) => a + b, 0) / (N || 1);
    for (const [t, f] of Object.entries(this.freqs)) this.idf[t] = Math.log(((N - f + 0.5) / (f + 0.5)) + 1);
    this.built = true;
  }
  search(query, k = 5) {
    if (!this.docs.length) return [];
    if (!this.built) this._build();
    const qToks = this._tok(query);
    return this.docs.map((doc, i) => {
      const tc = {}; for (const t of this.tokens[i]) tc[t] = (tc[t] || 0) + 1;
      let score = 0;
      for (const t of qToks) {
        if (!this.idf[t]) continue;
        const tf = tc[t] || 0;
        score += this.idf[t] * tf * (this.k1 + 1) / (tf + this.k1 * (1 - this.b + this.b * this.lens[i] / this.avgLen) + 1e-9);
      }
      return { text: doc.text, score };
    }).filter(s => s.score > 1e-9).sort((a, b) => b.score - a.score).slice(0, k);
  }
  get size() { return this.docs.length; }
  reset() { this.docs = []; this.tokens = []; this.lens = []; this.freqs = {}; this.idf = {}; this.avgLen = 0; this.built = false; }
}

class VectorStore {
  constructor() { this.items = []; }
  add(text, vec) { this.items.push({ text, vec }); }
  search(qVec, k = 5) {
    return this.items.map(item => ({ text: item.text, score: this._cos(qVec, item.vec) }))
      .sort((a, b) => b.score - a.score).slice(0, k);
  }
  _cos(a, b) {
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const mA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const mB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return mA && mB ? dot / (mA * mB) : 0;
  }
  get size() { return this.items.length; }
  reset() { this.items = []; }
}

function tfidfEmbed(text, vocab) {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  return vocab.map(w => words.filter(x => x === w).length / (words.length || 1));
}

function hybridRRF(vecRes, bm25Res, k = 3, K = 60) {
  const map = {};
  vecRes.forEach(({ text }, r) => { if (!map[text]) map[text] = { text, r: [Infinity, Infinity] }; map[text].r[0] = r + 1; });
  bm25Res.forEach(({ text }, r) => { if (!map[text]) map[text] = { text, r: [Infinity, Infinity] }; map[text].r[1] = r + 1; });
  return Object.values(map)
    .map(({ text, r }) => ({ text, score: r.reduce((s, x) => x !== Infinity ? s + 1 / (K + x) : s, 0) }))
    .filter(d => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

let vectorStore = new VectorStore();
let bm25Store = new BM25Index();
let vocab = [];

function chunkByChar(text, size = 500, overlap = 50) {
  const chunks = []; let s = 0;
  while (s < text.length) { const e = Math.min(s + size, text.length); chunks.push(text.slice(s, e)); s = e < text.length ? e - overlap : text.length; }
  return chunks;
}
function chunkBySentence(text, max = 5, overlap = 1) {
  const sents = text.split(/(?<=[.!?])\s+/); const chunks = []; let s = 0;
  while (s < sents.length) { chunks.push(sents.slice(s, s + max).join(" ")); s += max - overlap; if (s < 0) s = 0; }
  return chunks;
}
function chunkBySection(text) { return text.split(/\n## /).filter(c => c.trim()); }

// ── Document text extraction (PdfController equivalent) ────────────────────
async function extractText(buffer, mimeType) {
  if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "application/json" || mimeType === "text/markdown") {
    return buffer.toString("utf-8");
  }
  if (mimeType === "application/pdf") {
    try { const pdfParse = require("pdf-parse"); const d = await pdfParse(buffer); return d.text; } catch {}
    return buffer.toString("utf-8", 0, 50000).replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword") {
    try { const mammoth = require("mammoth"); const r = await mammoth.extractRawText({ buffer }); return r.value; } catch {}
  }
  // Excel / PPT: convert to string best-effort
  return buffer.toString("utf-8", 0, 50000).replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
}

// ── Tool Schemas ───────────────────────────────────────────────────────────
const chatTools = [
  { type: "function", function: { name: "get_current_datetime", description: "Returns current real date and time. Use for any date/time questions.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_live_price", description: "Fetches live price for GOLD, SILVER, BTC, ETH, SOL, stocks (AAPL, TSLA...). Always use for price questions.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "add_duration_to_datetime", description: "Add duration to a datetime.", parameters: { type: "object", properties: { datetime_str: { type: "string" }, duration: { type: "number" }, unit: { type: "string" } }, required: ["datetime_str", "duration", "unit"] } } },
  { type: "function", function: { name: "set_reminder", description: "Create a reminder.", parameters: { type: "object", properties: { content: { type: "string" }, timestamp: { type: "string" } }, required: ["content", "timestamp"] } } },
  { type: "function", function: { name: "db_query", description: "Run SQL query on local SQLite database. Tables: notes(id,title,content,created_at), tasks(id,task,status,created_at). Use for any data storage/retrieval.", parameters: { type: "object", properties: { query: { type: "string", description: "SQL query to execute" } }, required: ["query"] } } },
  { type: "function", function: { name: "web_search", description: "Search the web for current information, news, or facts.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
];

const editorTools = [
  { type: "function", function: { name: "str_replace_editor", description: "File editor: create, view, str_replace, insert, undo_edit.", parameters: { type: "object", properties: { command: { type: "string", enum: ["view", "create", "str_replace", "insert", "undo_edit"] }, path: { type: "string" }, file_text: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" }, insert_line: { type: "integer" }, view_range: { type: "array", items: { type: "integer" } } }, required: ["command", "path"] } } },
];

// ── Tool Executor ──────────────────────────────────────────────────────────
async function executeTool(name, args) {
  if (name === "get_current_datetime") return getCurrentDatetime();
  if (name === "get_live_price") return await getLivePrice(args.symbol);
  if (name === "add_duration_to_datetime") return addDurationToDatetime(args.datetime_str, args.duration, args.unit);
  if (name === "set_reminder") return setReminder(args.content, args.timestamp);
  if (name === "db_query") return dbQuery(args.query);
  if (name === "web_search") {
    try {
      const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`);
      const d = await r.json();
      return d.AbstractText || d.Answer || `No instant answer found for: ${args.query}`;
    } catch { return `Search failed for: ${args.query}`; }
  }
  return "Unknown tool";
}

// ── Groq chat helper ───────────────────────────────────────────────────────
async function groqChat(messages, tools = null, useModel = model) {
  const params = { model: useModel, messages, max_tokens: 2000 };
  if (tools) { params.tools = tools; params.tool_choice = "auto"; }
  const res = await client.chat.completions.create(params);
  return res.choices[0].message;
}

async function groqLoop(messages, tools, useModel = model) {
  let current = [...messages];
  while (true) {
    const msg = await groqChat(current, tools, useModel);
    if (!msg.tool_calls || !msg.tool_calls.length) return { reply: msg.content, messages: current };
    current.push(msg);
    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      const result = await executeTool(tc.function.name, args);
      current.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get("/api/reminders", (req, res) => res.json(reminders));

// ── AgentController: Chat Streaming ───────────────────────────────────────
app.post("/api/chat/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) { send({ type: "error", message: "messages required" }); return res.end(); }

    let current = [
      { role: "system", content: `You are a helpful AI assistant. Current date/time: ${getCurrentDatetime()}. Always use get_live_price for any price/market questions. Use db_query to store or retrieve data. Never say you lack real-time access — use tools.` },
      ...messages,
    ];

    while (true) {
      const msg = await groqChat(current, chatTools);
      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          send({ type: "tool_start", name: tc.function.name });
          const args = JSON.parse(tc.function.arguments);
          const result = await executeTool(tc.function.name, args);
          send({ type: "tool_result", name: tc.function.name, result: String(result) });
          current.push(msg);
          current.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
        }
        continue;
      }
      // Stream final answer
      const stream = await client.chat.completions.create({ model, messages: current, max_tokens: 2000, stream: true });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) send({ type: "text", text });
      }
      break;
    }
    send({ type: "done" });
  } catch (err) { send({ type: "error", message: err.message }); }
  finally { res.end(); }
});

// ── AgentController: Chat non-streaming ───────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });
    const sys = { role: "system", content: `Date/time: ${getCurrentDatetime()}. Use tools for live data.` };
    const { reply } = await groqLoop([sys, ...messages], chatTools);
    res.json({ reply });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EditorController ───────────────────────────────────────────────────────
app.post("/api/editor", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });
    const sys = { role: "system", content: "You are a file system assistant. ALWAYS use str_replace_editor tool for file operations." };
    const { reply, messages: updated } = await groqLoop([sys, ...messages], editorTools);
    res.json({ reply: reply || "Done.", messages: updated.filter(m => m.role !== "system") });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SearchController ───────────────────────────────────────────────────────
app.post("/api/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`);
    const ddg = await ddgRes.json();
    const abstract = ddg.AbstractText || "";
    const sources = (ddg.RelatedTopics || []).filter(t => t.Text && t.FirstURL).slice(0, 5).map(t => ({ title: t.Text, url: t.FirstURL }));
    if (abstract) return res.json({ reply: abstract, sources });
    const r = await client.chat.completions.create({ model, messages: [{ role: "system", content: `Today: ${getCurrentDatetime()}. Answer accurately.` }, { role: "user", content: query }], max_tokens: 800 });
    res.json({ reply: r.choices[0].message.content, sources });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RAG: Index (BM25 + Vector hybrid) ─────────────────────────────────────
app.post("/api/rag/index", (req, res) => {
  try {
    const { text, method = "section" } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    let chunks;
    if (method === "char") chunks = chunkByChar(text.slice(0, 20000));
    else if (method === "sentence") chunks = chunkBySentence(text.slice(0, 20000));
    else chunks = chunkBySection(text.slice(0, 20000));
    chunks = chunks.filter(c => c.trim().length > 0);
    vocab = [...new Set(chunks.flatMap(c => c.toLowerCase().split(/\W+/).filter(Boolean)))];
    vectorStore.reset(); bm25Store.reset();
    chunks.forEach(c => { vectorStore.add(c, tfidfEmbed(c, vocab)); bm25Store.add({ text: c }); });
    res.json({ message: `Indexed ${chunks.length} chunks (Hybrid BM25 + Vector)`, total: vectorStore.size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RAG: Search ────────────────────────────────────────────────────────────
app.post("/api/rag/search", (req, res) => {
  try {
    const { query, k = 3 } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    if (vectorStore.size === 0) return res.status(400).json({ error: "No documents indexed yet." });
    const qVec = tfidfEmbed(query, vocab);
    const results = hybridRRF(vectorStore.search(qVec, k * 2), bm25Store.search(query, k * 2), k);
    res.json({ results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/rag/status", (req, res) => res.json({ indexed: vectorStore.size }));

// ── PdfController: Image Analysis ─────────────────────────────────────────
app.post("/api/analyze/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const { prompt = "Describe this image in detail." } = req.body;
    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";
    const r = await client.chat.completions.create({
      model: visionModel,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }, { type: "text", text: prompt }] }],
      max_tokens: 1500,
    });
    res.json({ reply: r.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PdfController: Document Analysis (PDF, Word, TXT, CSV) ────────────────
app.post("/api/analyze/document", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No document uploaded" });
    const { prompt = "Summarize this document." } = req.body;
    const text = await extractText(req.file.buffer, req.file.mimetype);
    if (!text.trim()) return res.status(400).json({ error: "Could not extract text" });
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a document analysis assistant. Analyze thoroughly." },
        { role: "user", content: `Document:\n\n${text.slice(0, 15000)}\n\n---\n${prompt}` },
      ],
      max_tokens: 2000,
    });
    res.json({ reply: r.choices[0].message.content, chars: text.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── FileController: Upload file with reuse (cloud-style via file_id) ───────
app.post("/api/files/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = await extractText(req.file.buffer, req.file.mimetype);
    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    uploadedFiles[fileId] = { name: req.file.originalname, text, mimeType: req.file.mimetype, uploadedAt: new Date().toISOString(), size: req.file.size };
    res.json({ fileId, name: req.file.originalname, chars: text.length, uploadedAt: uploadedFiles[fileId].uploadedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/files", (req, res) => {
  res.json(Object.entries(uploadedFiles).map(([id, f]) => ({ fileId: id, name: f.name, chars: f.text.length, uploadedAt: f.uploadedAt })));
});

app.delete("/api/files/:fileId", (req, res) => {
  if (!uploadedFiles[req.params.fileId]) return res.status(404).json({ error: "File not found" });
  delete uploadedFiles[req.params.fileId];
  res.json({ deleted: req.params.fileId });
});

app.post("/api/files/:fileId/query", async (req, res) => {
  try {
    const file = uploadedFiles[req.params.fileId];
    if (!file) return res.status(404).json({ error: "File not found. Upload first." });
    const { prompt = "Summarize this document." } = req.body;
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a document analysis assistant." },
        { role: "user", content: `File: ${file.name}\n\n${file.text.slice(0, 15000)}\n\n---\n${prompt}` },
      ],
      max_tokens: 2000,
    });
    res.json({ reply: r.choices[0].message.content, file: file.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EvalController: Evaluate AI answer quality ────────────────────────────
app.post("/api/eval", async (req, res) => {
  try {
    const { question, answer, context = "" } = req.body;
    if (!question || !answer) return res.status(400).json({ error: "question and answer required" });
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: `You are an AI evaluator. Score answers on: Accuracy (1-5), Completeness (1-5), Clarity (1-5). Return JSON only: {"accuracy":N,"completeness":N,"clarity":N,"overall":N,"feedback":"..."}` },
        { role: "user", content: `Question: ${question}\nAnswer: ${answer}${context ? `\nContext: ${context}` : ""}` },
      ],
      max_tokens: 500,
    });
    try { res.json(JSON.parse(r.choices[0].message.content)); }
    catch { res.json({ raw: r.choices[0].message.content }); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EvalController: Generate test dataset ─────────────────────────────────
app.post("/api/eval/generate-dataset", async (req, res) => {
  try {
    const { text, count = 5 } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: `Generate ${count} Q&A pairs from the text. Return JSON array: [{"question":"...","answer":"...","type":"factual|reasoning|summary"}]` },
        { role: "user", content: text.slice(0, 8000) },
      ],
      max_tokens: 2000,
    });
    try { res.json({ dataset: JSON.parse(r.choices[0].message.content) }); }
    catch { res.json({ raw: r.choices[0].message.content }); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WorkflowController: Chain (sequential steps) ──────────────────────────
app.post("/api/workflow/chain", async (req, res) => {
  try {
    const { input, steps } = req.body; // steps: [{prompt: "...", system: "..."}]
    if (!input || !Array.isArray(steps) || !steps.length) return res.status(400).json({ error: "input and steps[] required" });
    let current = input;
    const results = [];
    for (const step of steps) {
      const r = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: step.system || "You are a helpful assistant." },
          { role: "user", content: `${step.prompt}\n\nInput:\n${current}` },
        ],
        max_tokens: 1500,
      });
      current = r.choices[0].message.content;
      results.push({ step: step.prompt, output: current });
    }
    res.json({ final: current, steps: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WorkflowController: Parallel (run multiple prompts simultaneously) ─────
app.post("/api/workflow/parallel", async (req, res) => {
  try {
    const { input, prompts } = req.body; // prompts: ["Summarize", "Extract key points", ...]
    if (!input || !Array.isArray(prompts) || !prompts.length) return res.status(400).json({ error: "input and prompts[] required" });
    const results = await Promise.all(prompts.map(async (prompt) => {
      const r = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: `${prompt}\n\nInput:\n${input}` }],
        max_tokens: 1000,
      });
      return { prompt, output: r.choices[0].message.content };
    }));
    res.json({ results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WorkflowController: Route (AI decides which agent to use) ──────────────
app.post("/api/workflow/route", async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: "input required" });

    // Step 1: Router decides category
    const routerRes = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: `Classify this input into exactly one category. Return JSON only: {"category":"code|math|general|creative|analysis","reason":"..."}` },
        { role: "user", content: input },
      ],
      max_tokens: 200,
    });
    let route;
    try { route = JSON.parse(routerRes.choices[0].message.content); } catch { route = { category: "general" }; }

    const systemPrompts = {
      code: "You are an expert software developer. Provide clean, working code with explanations.",
      math: "You are a math expert. Solve step by step showing all work.",
      general: "You are a helpful, knowledgeable assistant.",
      creative: "You are a creative writer. Be imaginative and engaging.",
      analysis: "You are an analytical expert. Provide structured, data-driven analysis.",
    };
    const sys = systemPrompts[route.category] || systemPrompts.general;
    const r = await client.chat.completions.create({ model, messages: [{ role: "system", content: sys }, { role: "user", content: input }], max_tokens: 1500 });
    res.json({ category: route.category, reason: route.reason, reply: r.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ToolController: Direct DB query ───────────────────────────────────────
app.post("/api/tools/db", (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    res.json({ result: JSON.parse(dbQuery(query)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/tools/db/tables", (req, res) => {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const schema = {};
    for (const { name } of tables) {
      schema[name] = db.prepare(`PRAGMA table_info(${name})`).all();
    }
    res.json({ tables: tables.map(t => t.name), schema });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Live Price direct endpoint ─────────────────────────────────────────────
app.get("/api/price/:symbol", async (req, res) => {
  try { res.json({ result: await getLivePrice(req.params.symbol) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 5000, () => console.log("Server running on port 5000"));
