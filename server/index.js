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

// ── Upload storage ─────────────────────────────────────────────────────────
const { memoryStorage } = multer;
const upload = multer({ storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── In-memory reminders ────────────────────────────────────────────────────
let reminders = [];

// ── Tool Functions ─────────────────────────────────────────────────────────

function getCurrentDatetime(date_format) {
  const now = new Date();
  if (!date_format || date_format === "%Y-%m-%d %H:%M:%S") {
    return now.toLocaleString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }
  // Simple format substitutions
  return now.toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function addDurationToDatetime(datetime_str, duration = 0, unit = "days") {
  const date = new Date(datetime_str);
  const ms = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
  let result;
  if (ms[unit]) {
    result = new Date(date.getTime() + duration * ms[unit]);
  } else if (unit === "months") {
    result = new Date(date);
    result.setMonth(result.getMonth() + duration);
  } else if (unit === "years") {
    result = new Date(date);
    result.setFullYear(result.getFullYear() + duration);
  } else {
    result = date;
  }
  return result.toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function setReminder(content, timestamp) {
  const reminder = { _id: String(Date.now()), content, timestamp };
  reminders.push(reminder);
  return `Reminder saved: "${content}" at ${timestamp}`;
}

async function getLivePrice(symbol) {
  const sym = symbol.toUpperCase().trim();

  // Gold / Silver / Metals via metals-api (free tier) or fallback
  const metalMap = { GOLD: "XAU", SILVER: "XAG", PLATINUM: "XPT", PALLADIUM: "XPD" };
  if (metalMap[sym] || sym === "XAU" || sym === "XAG") {
    const metalSym = metalMap[sym] || sym;
    try {
      const r = await fetch(`https://api.metals.live/v1/spot/${metalSym === "XAU" ? "gold" : metalSym === "XAG" ? "silver" : metalSym.toLowerCase()}`);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]) {
          const price = Object.values(d[0])[0];
          return `${sym} (${metalSym}) current spot price: $${price} USD per troy ounce`;
        }
      }
    } catch {}
    // fallback metals
    try {
      const r = await fetch(`https://metals-api.com/api/latest?access_key=free&base=USD&symbols=${metalSym}`);
      if (r.ok) {
        const d = await r.json();
        if (d.rates && d.rates[metalSym]) {
          const price = (1 / d.rates[metalSym]).toFixed(2);
          return `${sym} current spot price: $${price} USD per troy ounce`;
        }
      }
    } catch {}
  }

  // Crypto via CoinGecko (free, no key)
  const cryptoMap = {
    BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana",
    XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", USDT: "tether",
    DOT: "polkadot", MATIC: "matic-network", AVAX: "avalanche-2",
    LTC: "litecoin", LINK: "chainlink", UNI: "uniswap", ATOM: "cosmos",
  };
  const coinId = cryptoMap[sym] || sym.toLowerCase();
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
    if (r.ok) {
      const d = await r.json();
      if (d[coinId]) {
        const price = d[coinId].usd;
        const change = d[coinId].usd_24h_change?.toFixed(2);
        return `${sym} current price: $${price} USD (24h change: ${change}%)`;
      }
    }
  } catch {}

  // Stocks via Yahoo Finance unofficial quote
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (r.ok) {
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const change = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : "N/A";
        return `${sym} current price: $${price} USD (24h change: ${change}%, exchange: ${meta.exchangeName || "N/A"})`;
      }
    }
  } catch {}

  return `Could not fetch live price for ${sym}. Supported: crypto (BTC, ETH, etc.), stocks (AAPL, TSLA, etc.), metals (GOLD, SILVER).`;
}

// ── Text Editor ────────────────────────────────────────────────────────────
const BASE_DIR = path.resolve(__dirname);
const BACKUP_DIR = path.join(BASE_DIR, ".backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function validatePath(filePath) {
  const abs = path.resolve(BASE_DIR, filePath);
  if (!abs.startsWith(BASE_DIR + path.sep) && abs !== BASE_DIR)
    throw new Error(`Access denied: '${filePath}' is outside allowed directory`);
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
    if (fs.existsSync(abs)) throw new Error("File already exists. Use str_replace to modify it.");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, input.file_text, "utf-8");
    return `Successfully created ${input.path}`;
  }
  if (command === "str_replace") {
    const content = fs.readFileSync(abs, "utf-8");
    const count = content.split(input.old_str).length - 1;
    if (count === 0) throw new Error("No match found for replacement.");
    if (count > 1) throw new Error(`Found ${count} matches. Provide more context.`);
    backupFile(abs);
    fs.writeFileSync(abs, content.replace(input.old_str, input.new_str), "utf-8");
    return "Successfully replaced text.";
  }
  if (command === "insert") {
    backupFile(abs);
    const lines = fs.readFileSync(abs, "utf-8").split("\n");
    if (input.insert_line < 0 || input.insert_line > lines.length)
      throw new Error(`Line ${input.insert_line} out of range.`);
    lines.splice(input.insert_line, 0, input.new_str);
    fs.writeFileSync(abs, lines.join("\n"), "utf-8");
    return `Successfully inserted text after line ${input.insert_line}`;
  }
  if (command === "undo_edit") {
    const name = path.basename(abs);
    const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(name + ".")).sort().reverse();
    if (!backups.length) throw new Error("No backups found.");
    fs.copyFileSync(path.join(BACKUP_DIR, backups[0]), abs);
    return `Successfully restored ${input.path} from backup`;
  }
  throw new Error(`Unknown command: ${command}`);
}

// ── BM25 Index ─────────────────────────────────────────────────────────────
class BM25Index {
  constructor(k1 = 1.5, b = 0.75) {
    this.documents = [];
    this._corpusTokens = [];
    this._docLen = [];
    this._docFreqs = {};
    this._avgDocLen = 0;
    this._idf = {};
    this._indexBuilt = false;
    this.k1 = k1;
    this.b = b;
  }

  _tokenize(text) {
    return text.toLowerCase().split(/\W+/).filter(Boolean);
  }

  addDocument(doc) {
    const tokens = this._tokenize(doc.text);
    this.documents.push(doc);
    this._corpusTokens.push(tokens);
    this._docLen.push(tokens.length);
    const seen = new Set();
    for (const t of tokens) {
      if (!seen.has(t)) { this._docFreqs[t] = (this._docFreqs[t] || 0) + 1; seen.add(t); }
    }
    this._indexBuilt = false;
  }

  _buildIndex() {
    const N = this.documents.length;
    this._avgDocLen = this._docLen.reduce((a, b) => a + b, 0) / (N || 1);
    this._idf = {};
    for (const [term, freq] of Object.entries(this._docFreqs)) {
      this._idf[term] = Math.log(((N - freq + 0.5) / (freq + 0.5)) + 1);
    }
    this._indexBuilt = true;
  }

  search(query, k = 3) {
    if (!this.documents.length) return [];
    if (!this._indexBuilt) this._buildIndex();
    const qTokens = this._tokenize(query);
    const scores = this.documents.map((doc, i) => {
      const termCounts = {};
      for (const t of this._corpusTokens[i]) termCounts[t] = (termCounts[t] || 0) + 1;
      let score = 0;
      for (const t of qTokens) {
        if (!this._idf[t]) continue;
        const tf = termCounts[t] || 0;
        const num = this._idf[t] * tf * (this.k1 + 1);
        const den = tf + this.k1 * (1 - this.b + this.b * (this._docLen[i] / this._avgDocLen));
        score += num / (den + 1e-9);
      }
      return { text: doc.text, score };
    });
    return scores.filter(s => s.score > 1e-9).sort((a, b) => b.score - a.score).slice(0, k);
  }

  get size() { return this.documents.length; }
}

// ── Simple TF-IDF Vector Store ─────────────────────────────────────────────
class VectorStore {
  constructor() { this.items = []; }
  add(text, vector) { this.items.push({ text, vector }); }
  search(queryVector, k = 3) {
    return this.items
      .map((item) => ({ text: item.text, score: this._cosine(queryVector, item.vector) }))
      .sort((a, b) => b.score - a.score).slice(0, k);
  }
  _cosine(a, b) {
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return magA && magB ? dot / (magA * magB) : 0;
  }
  get size() { return this.items.length; }
}

function simpleEmbed(text, vocab) {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  return vocab.map((word) => words.filter((w) => w === word).length / (words.length || 1));
}

// Hybrid RRF merge
function hybridSearch(vectorResults, bm25Results, k = 3, k_rrf = 60) {
  const docMap = {};
  const allResults = [vectorResults, bm25Results];
  for (const results of allResults) {
    results.forEach(({ text }, rank) => {
      if (!docMap[text]) docMap[text] = { text, ranks: [Infinity, Infinity] };
    });
  }
  vectorResults.forEach(({ text }, rank) => { if (docMap[text]) docMap[text].ranks[0] = rank + 1; });
  bm25Results.forEach(({ text }, rank) => { if (docMap[text]) docMap[text].ranks[1] = rank + 1; });

  return Object.values(docMap)
    .map(({ text, ranks }) => ({
      text,
      score: ranks.reduce((s, r) => r !== Infinity ? s + 1.0 / (k_rrf + r) : s, 0),
    }))
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

let vectorStore = new VectorStore();
let bm25Store = new BM25Index();
let vocab = [];

// ── Chunking ───────────────────────────────────────────────────────────────
function chunkByChar(text, chunkSize = 500, overlap = 50) {
  const chunks = []; let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end < text.length ? end - overlap : text.length;
  }
  return chunks;
}
function chunkBySentence(text, maxSentences = 5, overlap = 1) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = []; let start = 0;
  while (start < sentences.length) {
    chunks.push(sentences.slice(start, start + maxSentences).join(" "));
    start += maxSentences - overlap;
    if (start < 0) start = 0;
  }
  return chunks;
}
function chunkBySection(text) { return text.split(/\n## /).filter((c) => c.trim()); }

// ── Tool Schemas ───────────────────────────────────────────────────────────
const chatTools = [
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Returns the current real date and time. Use this whenever the user asks what time or date it is today.",
      parameters: {
        type: "object",
        properties: {
          date_format: { type: "string", description: "Format string, default '%Y-%m-%d %H:%M:%S'" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_price",
      description: "Fetches live real-time price for gold, silver, crypto (BTC, ETH, SOL...), or stocks (AAPL, TSLA...). Use this for any price questions.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Symbol like GOLD, SILVER, BTC, ETH, AAPL, TSLA, etc." },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_duration_to_datetime",
      description: "Adds a duration to a datetime and returns the result.",
      parameters: {
        type: "object",
        properties: {
          datetime_str: { type: "string", description: "ISO date string e.g. 2025-01-15" },
          duration: { type: "number", description: "Amount to add" },
          unit: { type: "string", description: "seconds, minutes, hours, days, weeks, months, years" },
        },
        required: ["datetime_str", "duration", "unit"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Creates a reminder with a message and timestamp.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Reminder message" },
          timestamp: { type: "string", description: "ISO 8601 timestamp e.g. 2025-06-01T09:00:00" },
        },
        required: ["content", "timestamp"],
      },
    },
  },
];

const editorTools = [
  {
    type: "function",
    function: {
      name: "str_replace_editor",
      description: "A file system editor. Use this tool to create, view, edit, insert into, or undo edits on files.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", enum: ["view", "create", "str_replace", "insert", "undo_edit"] },
          path: { type: "string" },
          file_text: { type: "string" },
          old_str: { type: "string" },
          new_str: { type: "string" },
          insert_line: { type: "integer" },
          view_range: { type: "array", items: { type: "integer" } },
        },
        required: ["command", "path"],
      },
    },
  },
];

// ── Tool Executor ──────────────────────────────────────────────────────────
async function executeChatTool(name, args) {
  if (name === "get_current_datetime") return getCurrentDatetime(args.date_format);
  if (name === "get_live_price") return await getLivePrice(args.symbol);
  if (name === "add_duration_to_datetime") return addDurationToDatetime(args.datetime_str, args.duration, args.unit);
  if (name === "set_reminder") return setReminder(args.content, args.timestamp);
  return "Unknown tool";
}

// ── Routes ─────────────────────────────────────────────────────────────────
app.get("/api/reminders", (req, res) => res.json(reminders));

// Chat streaming
app.post("/api/chat/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) { send({ type: "error", message: "messages required" }); return res.end(); }

    let current = [
      {
        role: "system",
        content: `You are a helpful AI assistant. Today's date/time is ${getCurrentDatetime()}. 
You have access to live price tools - ALWAYS use get_live_price tool for any price questions (gold, silver, crypto, stocks).
ALWAYS use get_current_datetime tool when user asks about current date or time.
Never say you don't have access to real-time data — use the tools provided.`,
      },
      ...messages,
    ];

    while (true) {
      const toolCheck = await client.chat.completions.create({ model, messages: current, tools: chatTools, tool_choice: "auto", max_tokens: 1500 });
      const msg = toolCheck.choices[0].message;

      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          send({ type: "tool_start", name: tc.function.name });
          send({ type: "tool_input", partial: tc.function.arguments });
          const args = JSON.parse(tc.function.arguments);
          const result = await executeChatTool(tc.function.name, args);
          send({ type: "tool_result", name: tc.function.name, result: String(result) });
          current.push(msg);
          current.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
        }
        continue;
      }

      const stream = await client.chat.completions.create({ model, messages: current, max_tokens: 1500, stream: true });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) send({ type: "text", text });
      }
      break;
    }
    send({ type: "done" });
  } catch (err) {
    send({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

// Chat non-streaming (backward compat)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });
    let current = [{ role: "system", content: `Today's date/time is ${getCurrentDatetime()}. Use tools for live prices and current time.` }, ...messages];
    while (true) {
      const response = await client.chat.completions.create({ model, messages: current, tools: chatTools, tool_choice: "auto", max_tokens: 1500 });
      const msg = response.choices[0].message;
      if (!msg.tool_calls || !msg.tool_calls.length) return res.json({ reply: msg.content });
      current.push(msg);
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const result = await executeChatTool(tc.function.name, args);
        current.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Text Editor
app.post("/api/editor", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });
    let current = [...messages];
    while (true) {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: "You are a file system assistant. ALWAYS use the str_replace_editor tool for any file operation." }, ...current],
        tools: editorTools, tool_choice: "auto", max_tokens: 2000,
      });
      const msg = response.choices[0].message;
      if (!msg.tool_calls || !msg.tool_calls.length) return res.json({ reply: msg.content || "Done.", messages: current });
      current.push(msg);
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        try {
          const result = editorRun(args.command, args);
          current.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
        } catch (e) {
          current.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${e.message}` });
        }
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Web Search
app.post("/api/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });

    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgUrl);
    const ddgData = await ddgRes.json();
    const abstract = ddgData.AbstractText || "";
    const sources = (ddgData.RelatedTopics || []).filter((t) => t.Text && t.FirstURL).slice(0, 5).map((t) => ({ title: t.Text, url: t.FirstURL }));

    if (abstract) return res.json({ reply: abstract, sources });

    const today = new Date().toISOString().split("T")[0];
    const groqRes = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: `You are a helpful assistant. Today is ${today}. Answer accurately with real numbers and facts.` },
        { role: "user", content: query },
      ],
      max_tokens: 800,
    });
    res.json({ reply: groqRes.choices[0].message.content, sources });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RAG - Index (hybrid: vector + BM25)
app.post("/api/rag/index", (req, res) => {
  try {
    const { text, method = "section" } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    let chunks;
    if (method === "char") chunks = chunkByChar(text.slice(0, 20000));
    else if (method === "sentence") chunks = chunkBySentence(text.slice(0, 20000));
    else chunks = chunkBySection(text.slice(0, 20000));

    chunks = chunks.filter((c) => c.trim().length > 0);

    const allWords = chunks.flatMap((c) => c.toLowerCase().split(/\W+/).filter(Boolean));
    vocab = [...new Set(allWords)];
    vectorStore = new VectorStore();
    bm25Store = new BM25Index();
    chunks.forEach((chunk) => {
      vectorStore.add(chunk, simpleEmbed(chunk, vocab));
      bm25Store.addDocument({ text: chunk });
    });

    res.json({ message: `Indexed ${chunks.length} chunks (hybrid BM25 + vector)`, total: vectorStore.size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RAG - Search (hybrid)
app.post("/api/rag/search", (req, res) => {
  try {
    const { query, k = 3 } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    if (vectorStore.size === 0) return res.status(400).json({ error: "No documents indexed yet." });

    const queryVector = simpleEmbed(query, vocab);
    const vectorResults = vectorStore.search(queryVector, k * 2);
    const bm25Results = bm25Store.search(query, k * 2);
    const results = hybridSearch(vectorResults, bm25Results, k);
    res.json({ results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/rag/status", (req, res) => res.json({ indexed: vectorStore.size }));

// ── Image Analysis ─────────────────────────────────────────────────────────
app.post("/api/analyze/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const { prompt = "Describe this image in detail." } = req.body;
    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

    const response = await client.chat.completions.create({
      model: visionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens: 1500,
    });

    res.json({ reply: response.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PDF / Document Analysis ────────────────────────────────────────────────
app.post("/api/analyze/document", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No document uploaded" });
    const { prompt = "Summarize this document." } = req.body;

    let textContent = "";
    const mimeType = req.file.mimetype;

    if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "application/json") {
      textContent = req.file.buffer.toString("utf-8");
    } else if (mimeType === "application/pdf") {
      // Extract text from PDF using basic parsing (no external lib needed)
      // Use a simple PDF text extraction
      try {
        const pdfParse = require("pdf-parse");
        const data = await pdfParse(req.file.buffer);
        textContent = data.text;
      } catch {
        // Fallback: send raw buffer as base64 and ask AI to process text portions
        textContent = req.file.buffer.toString("utf-8", 0, Math.min(req.file.buffer.length, 50000))
          .replace(/[^\x20-\x7E\n\r\t]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    } else {
      textContent = req.file.buffer.toString("utf-8", 0, Math.min(req.file.buffer.length, 50000));
    }

    if (!textContent.trim()) return res.status(400).json({ error: "Could not extract text from document" });

    const truncated = textContent.slice(0, 15000);
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a document analysis assistant. Analyze the provided document content thoroughly.",
        },
        {
          role: "user",
          content: `Document content:\n\n${truncated}\n\n---\n${prompt}`,
        },
      ],
      max_tokens: 2000,
    });

    res.json({ reply: response.choices[0].message.content, chars: textContent.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Live Price endpoint (direct) ───────────────────────────────────────────
app.get("/api/price/:symbol", async (req, res) => {
  try {
    const result = await getLivePrice(req.params.symbol);
    res.json({ result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 5000, () => console.log("Server running on port 5000"));
