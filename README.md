# 🤖 AI Tools Dashboard

A full-stack MERN application with 11 AI-powered tools built using **Groq + Llama 3.3**.

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Bootstrap 5, React-Bootstrap |
| Backend | Node.js, Express.js |
| AI Model | Groq API — `llama-3.3-70b-versatile` |
| Vision Model | Groq API — `llama-3.2-90b-vision-preview` |
| Database | SQLite (better-sqlite3) |
| File Parsing | pdf-parse, mammoth |
| File Uploads | multer |

---

## 📦 Project Structure

```
mern-tools/
├── client/                  # React Frontend
│   ├── src/
│   │   ├── App.jsx          # All 11 tabs UI
│   │   └── index.jsx
│   └── package.json
├── server/                  # Express Backend
│   ├── index.js             # All routes + tools + controllers
│   ├── .env                 # API keys (not uploaded)
│   └── package.json
└── README.md
```

---

## ⚙️ Setup & Installation

### 1. Clone the repo
```bash
git clone https://github.com/Excelsior-Technologies-Community/anthropic_course_krunal.git
cd anthropic_course_krunal
```

### 2. Setup Server
```bash
cd server
npm install
```

Create `.env` file inside `server/`:
```env
GROQ_API_KEY=your_groq_api_key_here
PORT=5000
```

> Get your free Groq API key at: https://console.groq.com

### 3. Setup Client
```bash
cd ../client
npm install
```

### 4. Run the App

**Terminal 1 — Backend:**
```bash
cd server
node index.js
```

**Terminal 2 — Frontend:**
```bash
cd client
npm start
```

App opens at: **http://localhost:3000**

---

## 🛠️ All Tools

### 💬 Chat — AgentController
- Streaming AI chat with tool calling
- Tools active inside chat: live prices, datetime, reminders, DB queries, web search
- Full conversation history maintained

### 💰 Live Prices — PriceController
- Real-time gold & silver prices (metals.live API)
- Crypto prices: BTC, ETH, SOL, XRP, DOGE, and more (CoinGecko API)
- Stock prices: AAPL, TSLA, AMZN, and more (Yahoo Finance)

### 🖼️ Image AI — Vision (PdfController)
- Upload any image (JPG, PNG, GIF, WebP)
- AI analyzes using Llama vision model
- Custom prompts: describe, extract text, fire risk, object detection

### 📄 Document AI — PdfController
- Upload PDF, Word (.docx), TXT, CSV, JSON, MD
- Extracts text locally then sends to AI
- Custom prompts: summarize, key points, data extraction

### 📁 File Manager — FileController
- Upload files once, reuse by `fileId`
- Cloud-style file pipeline (without external cloud)
- Query any uploaded file multiple times without re-uploading

### 🧪 Eval — EvalController
- Evaluate AI answer quality (Accuracy, Completeness, Clarity scores 1-5)
- Auto-generate Q&A datasets from any text
- Useful for testing and benchmarking AI responses

### ⚙️ Workflow — WorkflowController
Three orchestration modes:
- **🔀 Route** — AI automatically classifies input and picks the best agent (code/math/creative/analysis/general)
- **🔗 Chain** — Sequential steps where output of one step feeds into the next
- **⚡ Parallel** — Run multiple prompts on the same input simultaneously

### 🗄️ Database — ToolController
- Direct SQLite query interface
- Built-in tables: `notes`, `tasks`
- Schema viewer, quick query buttons
- AI chat can also query the DB using `db_query` tool

### 📝 File Editor — EditorController
- AI-powered file editor (create, view, edit, insert, undo)
- Automatic backups before every edit
- Path-safe — restricted to server directory

### 🔍 Web Search — SearchController
- DuckDuckGo instant answers (no API key needed)
- Falls back to Groq AI for complex queries

### 📚 RAG — Hybrid Semantic Search
- Index any text with 3 chunking methods: section, sentence, character
- **Hybrid search**: BM25 (keyword) + TF-IDF Vector (semantic) combined with RRF scoring
- Better results than single-method search

---

## 🔧 Available API Endpoints

### Chat
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/chat/stream` | Streaming chat with tools |
| POST | `/api/chat` | Non-streaming chat |
| GET | `/api/reminders` | Get all reminders |

### Files & Documents
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/analyze/image` | Analyze uploaded image |
| POST | `/api/analyze/document` | Analyze PDF/Word/TXT |
| POST | `/api/files/upload` | Upload file (get fileId) |
| GET | `/api/files` | List all uploaded files |
| POST | `/api/files/:fileId/query` | Query a file by fileId |
| DELETE | `/api/files/:fileId` | Delete uploaded file |

### Prices
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/price/:symbol` | Get live price (GOLD, BTC, AAPL...) |

### RAG
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/rag/index` | Index text chunks |
| POST | `/api/rag/search` | Hybrid search |
| GET | `/api/rag/status` | Check indexed count |

### Eval
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/eval` | Evaluate answer quality |
| POST | `/api/eval/generate-dataset` | Generate Q&A dataset |

### Workflow
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/workflow/route` | Auto-route to best agent |
| POST | `/api/workflow/chain` | Sequential step chaining |
| POST | `/api/workflow/parallel` | Parallel prompt execution |

### Tools
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/tools/db` | Run SQL query |
| GET | `/api/tools/db/tables` | Get DB schema |
| POST | `/api/editor` | File editor operations |
| POST | `/api/search` | Web search |

---

## 🤖 AI Tools Available in Chat

The chat automatically uses these tools when needed:

| Tool | Trigger |
|---|---|
| `get_current_datetime` | "What time is it?" / "What is today's date?" |
| `get_live_price` | "Gold price?" / "BTC price?" / "AAPL stock?" |
| `add_duration_to_datetime` | "Add 10 days to 2025-01-01" |
| `set_reminder` | "Remind me to call John at 9am" |
| `db_query` | "Save a note" / "Show all tasks" |
| `web_search` | "Search for latest news about..." |

---

## 📸 Features Preview

- ✅ Real-time streaming responses
- ✅ Live gold, silver, crypto, stock prices
- ✅ Image analysis with vision AI
- ✅ PDF and Word document parsing
- ✅ File upload & reuse system
- ✅ AI answer evaluation with scores
- ✅ Q&A dataset generation
- ✅ Workflow orchestration (chain/parallel/route)
- ✅ SQLite database with AI access
- ✅ Hybrid BM25 + Vector RAG search
- ✅ File editor with auto-backup
- ✅ Web search integration

---

## 🔑 Environment Variables

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
PORT=5000
```

---

## 📄 License

MIT License — Free to use and modify.

---

Built with ❤️ using Groq + Llama 3.3 + MERN Stack
