import { useState, useEffect, useRef } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Container, Row, Col, Card, Tab, Tabs, Form, Button,
  Badge, Spinner, Alert, ListGroup, InputGroup, Table,
} from "react-bootstrap";

// ── Chat Tab ────────────────────────────────────────────────────────────────
function ChatTab() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingMsg, setStreamingMsg] = useState("");
  const [reminders, setReminders] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => { fetchReminders(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingMsg]);

  async function fetchReminders() {
    try { const { data } = await axios.get("/api/reminders"); setReminders(Array.isArray(data) ? data : []); } catch {}
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);
    setStreamingMsg("");

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === "text") { assembled += chunk.text; setStreamingMsg(assembled); }
          else if (chunk.type === "tool_start") { assembled += `\n🔧 Using tool: **${chunk.name}**\n`; setStreamingMsg(assembled); }
          else if (chunk.type === "tool_result") { assembled += `✅ ${chunk.result}\n\n`; setStreamingMsg(assembled); }
          else if (chunk.type === "done") {
            setMessages((prev) => [...prev, { role: "assistant", content: assembled }]);
            setStreamingMsg("");
            fetchReminders();
          } else if (chunk.type === "error") {
            setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${chunk.message}`, error: true }]);
            setStreamingMsg("");
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}`, error: true }]);
      setStreamingMsg("");
    } finally { setLoading(false); }
  }

  return (
    <Row className="h-100 g-3">
      <Col md={8} className="d-flex flex-column">
        <Card className="flex-grow-1 shadow-sm">
          <Card.Header className="bg-primary text-white fw-bold">💬 AI Chat</Card.Header>
          <Card.Body className="overflow-auto" style={{ maxHeight: "60vh" }}>
            {messages.length === 0 && (
              <div className="text-center text-muted mt-4">
                <p>👋 Try asking:</p>
                <p><code>What is today's gold price?</code></p>
                <p><code>What is the price of Bitcoin?</code></p>
                <p><code>What is today's date?</code></p>
                <p><code>Remind me to call John at 2025-12-01T09:00:00</code></p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`d-flex mb-3 ${m.role === "user" ? "justify-content-end" : "justify-content-start"}`}>
                <div className={`px-3 py-2 rounded-3 ${m.role === "user" ? "bg-primary text-white" : m.error ? "bg-danger text-white" : "bg-light border"}`}
                  style={{ maxWidth: "75%", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  <small className="fw-bold d-block mb-1">{m.role === "user" ? "You" : "🤖 AI"}</small>
                  {m.content}
                </div>
              </div>
            ))}
            {streamingMsg && (
              <div className="d-flex justify-content-start mb-3">
                <div className="px-3 py-2 rounded-3 bg-light border" style={{ maxWidth: "75%", whiteSpace: "pre-wrap" }}>
                  <small className="fw-bold d-block mb-1">🤖 AI</small>
                  {streamingMsg}
                </div>
              </div>
            )}
            {loading && !streamingMsg && (
              <div className="d-flex justify-content-start mb-3">
                <div className="px-3 py-2 rounded-3 bg-light border">
                  <Spinner animation="border" size="sm" className="me-2" />Thinking...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </Card.Body>
          <Card.Footer className="bg-white">
            <Form onSubmit={sendMessage}>
              <InputGroup>
                <Form.Control
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={"e.g. What is today's gold price? or What date is it?"}
                  disabled={loading}
                />
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? <Spinner animation="border" size="sm" /> : "Send"}
                </Button>
              </InputGroup>
            </Form>
          </Card.Footer>
        </Card>
      </Col>

      <Col md={4}>
        <Card className="shadow-sm h-100">
          <Card.Header className="bg-warning fw-bold">
            🔔 Reminders <Badge bg="secondary">{reminders.length}</Badge>
          </Card.Header>
          <Card.Body className="overflow-auto" style={{ maxHeight: "65vh" }}>
            {reminders.length === 0
              ? <p className="text-muted text-center mt-3">No reminders yet.</p>
              : <ListGroup variant="flush">
                  {reminders.map((r) => (
                    <ListGroup.Item key={r._id} className="px-0">
                      <div className="fw-semibold">{r.content}</div>
                      <small className="text-muted">🕐 {r.timestamp}</small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
            }
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}

// ── Live Price Tab ──────────────────────────────────────────────────────────
function PriceTab() {
  const [symbol, setSymbol] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const quickSymbols = [
    { label: "🥇 Gold", sym: "GOLD" },
    { label: "🥈 Silver", sym: "SILVER" },
    { label: "₿ Bitcoin", sym: "BTC" },
    { label: "Ξ Ethereum", sym: "ETH" },
    { label: "◎ Solana", sym: "SOL" },
    { label: "🍎 Apple", sym: "AAPL" },
    { label: "⚡ Tesla", sym: "TSLA" },
    { label: "📦 Amazon", sym: "AMZN" },
  ];

  async function fetchPrice(sym) {
    const s = (sym || symbol).trim();
    if (!s) return;
    setLoading(true); setResult(""); setError("");
    try {
      const { data } = await axios.get(`/api/price/${s}`);
      setResult(data.result);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold text-white" style={{ background: "#f0a500" }}>💰 Live Prices — Gold, Crypto, Stocks</Card.Header>
      <Card.Body>
        <Form onSubmit={(e) => { e.preventDefault(); fetchPrice(); }} className="mb-3">
          <InputGroup>
            <Form.Control
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Enter symbol: GOLD, BTC, ETH, AAPL, TSLA..."
              disabled={loading}
            />
            <Button type="submit" style={{ background: "#f0a500", border: "none" }} disabled={loading}>
              {loading ? <Spinner animation="border" size="sm" /> : "Get Price"}
            </Button>
          </InputGroup>
        </Form>

        <div className="d-flex flex-wrap gap-2 mb-3">
          {quickSymbols.map(({ label, sym }) => (
            <Button key={sym} size="sm" variant="outline-secondary" onClick={() => { setSymbol(sym); fetchPrice(sym); }}>
              {label}
            </Button>
          ))}
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {result && (
          <Alert variant="success" className="fs-5 fw-semibold">
            📊 {result}
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
}

// ── Image Analysis Tab ──────────────────────────────────────────────────────
function ImageTab() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [prompt, setPrompt] = useState("Describe this image in detail.");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function onFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(""); setError("");
  }

  async function analyze(e) {
    e.preventDefault();
    if (!file) return;
    setLoading(true); setResult(""); setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("prompt", prompt);
      const { data } = await axios.post("/api/analyze/image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data.reply);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-danger text-white fw-bold">🖼️ Image Analysis</Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={5}>
            <Form onSubmit={analyze}>
              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold">Upload Image (JPG, PNG, GIF, WebP)</Form.Label>
                <Form.Control type="file" accept="image/*" onChange={onFileChange} />
              </Form.Group>
              {preview && (
                <div className="mb-3 text-center">
                  <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, border: "1px solid #ddd" }} />
                </div>
              )}
              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold">Analysis Prompt</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What do you want to know about the image?"
                />
              </Form.Group>
              <div className="d-flex gap-2 flex-wrap mb-2">
                {["Describe this image in detail.", "What objects are in this image?", "Analyze the fire risk of this property.", "What text is in this image?"].map(p => (
                  <Button key={p} size="sm" variant="outline-danger" onClick={() => setPrompt(p)}>{p.slice(0, 30)}...</Button>
                ))}
              </div>
              <Button type="submit" variant="danger" disabled={!file || loading} className="w-100">
                {loading ? <><Spinner animation="border" size="sm" className="me-2" />Analyzing...</> : "🔍 Analyze Image"}
              </Button>
            </Form>
          </Col>
          <Col md={7}>
            {error && <Alert variant="danger">{error}</Alert>}
            {result && (
              <Card className="h-100 border-0 bg-light">
                <Card.Header className="fw-bold bg-light">🤖 Analysis Result</Card.Header>
                <Card.Body style={{ whiteSpace: "pre-wrap", overflowY: "auto", maxHeight: "50vh" }}>{result}</Card.Body>
              </Card>
            )}
            {!result && !error && (
              <div className="text-center text-muted mt-5">
                <p>📷 Upload an image and click Analyze</p>
                <p className="small">Supports: JPG, PNG, GIF, WebP<br />Max size: 20MB</p>
              </div>
            )}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── Document / PDF Analysis Tab ─────────────────────────────────────────────
function DocumentTab() {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState("Summarize this document.");
  const [result, setResult] = useState("");
  const [chars, setChars] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function onFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f); setResult(""); setError("");
  }

  async function analyze(e) {
    e.preventDefault();
    if (!file) return;
    setLoading(true); setResult(""); setError("");
    try {
      const formData = new FormData();
      formData.append("document", file);
      formData.append("prompt", prompt);
      const { data } = await axios.post("/api/analyze/document", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data.reply);
      setChars(data.chars || 0);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-secondary text-white fw-bold">📄 Document / PDF Analysis</Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={5}>
            <Form onSubmit={analyze}>
              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold">Upload Document (PDF, TXT, CSV, JSON)</Form.Label>
                <Form.Control type="file" accept=".pdf,.txt,.csv,.json,.md" onChange={onFileChange} />
                {file && <Form.Text className="text-muted">📁 {file.name} ({(file.size / 1024).toFixed(1)} KB)</Form.Text>}
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold">Analysis Prompt</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What do you want to know about this document?"
                />
              </Form.Group>
              <div className="d-flex gap-2 flex-wrap mb-2">
                {["Summarize this document.", "Extract all key points.", "What are the main topics?", "List all important numbers and data."].map(p => (
                  <Button key={p} size="sm" variant="outline-secondary" onClick={() => setPrompt(p)}>{p}</Button>
                ))}
              </div>
              <Button type="submit" variant="secondary" disabled={!file || loading} className="w-100">
                {loading ? <><Spinner animation="border" size="sm" className="me-2" />Analyzing...</> : "🔍 Analyze Document"}
              </Button>
            </Form>
          </Col>
          <Col md={7}>
            {error && <Alert variant="danger">{error}</Alert>}
            {chars > 0 && <Alert variant="info" className="py-1 small">📊 Extracted {chars.toLocaleString()} characters from document</Alert>}
            {result && (
              <Card className="border-0 bg-light">
                <Card.Header className="fw-bold bg-light">🤖 Analysis Result</Card.Header>
                <Card.Body style={{ whiteSpace: "pre-wrap", overflowY: "auto", maxHeight: "50vh" }}>{result}</Card.Body>
              </Card>
            )}
            {!result && !error && (
              <div className="text-center text-muted mt-5">
                <p>📄 Upload a document and click Analyze</p>
                <p className="small">Supports: PDF, TXT, CSV, JSON, MD<br />Max size: 20MB</p>
              </div>
            )}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── Editor Tab ──────────────────────────────────────────────────────────────
function EditorTab() {
  const [messages, setMessages] = useState([]);
  const [editorMsgs, setEditorMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const newMsgs = [...editorMsgs, { role: "user", content: input }];
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    setInput("");
    setLoading(true);
    try {
      const { data } = await axios.post("/api/editor", { messages: newMsgs });
      setEditorMsgs(data.messages || newMsgs);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply || data.error }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}`, error: true }]);
    } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-success text-white fw-bold">📝 Text Editor</Card.Header>
      <Card.Body>
        <Alert variant="info" className="py-2">
          Ask AI to <strong>create</strong>, <strong>view</strong>, <strong>edit</strong>, <strong>insert</strong>, or <strong>undo</strong> files in the server folder.
        </Alert>
        <div className="overflow-auto mb-3 p-2 border rounded bg-light" style={{ minHeight: 200, maxHeight: "50vh" }}>
          {messages.length === 0 && <p className="text-muted text-center mt-3">Try: <code>Create a file called notes.txt with content Hello World</code></p>}
          {messages.map((m, i) => (
            <div key={i} className={`d-flex mb-3 ${m.role === "user" ? "justify-content-end" : "justify-content-start"}`}>
              <div className={`px-3 py-2 rounded-3 ${m.role === "user" ? "bg-success text-white" : m.error ? "bg-danger text-white" : "bg-white border"}`}
                style={{ maxWidth: "80%", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                <small className="fw-bold d-block mb-1">{m.role === "user" ? "You" : "🤖 AI"}</small>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div className="d-flex justify-content-start"><div className="px-3 py-2 rounded-3 bg-white border"><Spinner animation="border" size="sm" className="me-2" />Working...</div></div>}
          <div ref={bottomRef} />
        </div>
        <Form onSubmit={send}>
          <InputGroup>
            <Form.Control value={input} onChange={(e) => setInput(e.target.value)} placeholder='e.g. "Create a file called notes.txt with content Hello World"' disabled={loading} />
            <Button type="submit" variant="success" disabled={loading}>{loading ? <Spinner animation="border" size="sm" /> : "Send"}</Button>
          </InputGroup>
        </Form>
      </Card.Body>
    </Card>
  );
}

// ── Search Tab ──────────────────────────────────────────────────────────────
function SearchTab() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setResult(null); setError("");
    try {
      const { data } = await axios.post("/api/search", { query });
      if (data.error) setError(data.error); else setResult(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-info text-white fw-bold">🔍 Web Search</Card.Header>
      <Card.Body>
        <Form onSubmit={search} className="mb-4">
          <InputGroup>
            <Form.Control value={query} onChange={(e) => setQuery(e.target.value)} placeholder='e.g. "What is machine learning?"' disabled={loading} size="lg" />
            <Button type="submit" variant="info" disabled={loading} className="text-white">
              {loading ? <><Spinner animation="border" size="sm" className="me-2" />Searching...</> : "🔍 Search"}
            </Button>
          </InputGroup>
        </Form>
        {error && <Alert variant="danger">{error}</Alert>}
        {result && (
          <>
            <Card className="mb-3 border-0 bg-light"><Card.Body style={{ whiteSpace: "pre-wrap" }}>{result.reply}</Card.Body></Card>
            {result.sources?.length > 0 && (
              <>
                <h6 className="fw-bold">📎 Related Topics:</h6>
                <ListGroup>
                  {result.sources.map((s, i) => (
                    <ListGroup.Item key={i} action href={s.url} target="_blank" rel="noreferrer">🔗 {s.title}</ListGroup.Item>
                  ))}
                </ListGroup>
              </>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
}

// ── RAG Tab ─────────────────────────────────────────────────────────────────
function RagTab() {
  const [text, setText] = useState("");
  const [method, setMethod] = useState("section");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [indexed, setIndexed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });

  async function indexText(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true); setMsg({ text: "", type: "" });
    try {
      const { data } = await axios.post("/api/rag/index", { text, method });
      if (data.error) setMsg({ text: data.error, type: "danger" });
      else { setMsg({ text: data.message, type: "success" }); setIndexed(data.total); setText(""); }
    } catch (err) { setMsg({ text: err.message, type: "danger" }); }
    finally { setLoading(false); }
  }

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setMsg({ text: "", type: "" });
    try {
      const { data } = await axios.post("/api/rag/search", { query, k: 3 });
      if (data.error) setMsg({ text: data.error, type: "danger" }); else setResults(data.results);
    } catch (err) { setMsg({ text: err.message, type: "danger" }); }
    finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold" style={{ background: "#6f42c1", color: "white" }}>
        📚 RAG — Hybrid Semantic Search (BM25 + Vector)
      </Card.Header>
      <Card.Body>
        <Row className="g-4">
          <Col md={6}>
            <h6 className="fw-bold">Step 1 — Index Text</h6>
            <Form onSubmit={indexText}>
              <Form.Control as="textarea" rows={6} className="mb-2" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Paste text to index...\n\nExample:\n## Section 1\nContent here...\n\n## Section 2\nMore content..."} />
              <InputGroup className="mb-2">
                <Form.Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="section">By Section (##)</option>
                  <option value="sentence">By Sentence</option>
                  <option value="char">By Characters</option>
                </Form.Select>
                <Button type="submit" style={{ background: "#6f42c1", color: "white", border: "none" }} disabled={loading}>
                  {loading ? <Spinner animation="border" size="sm" /> : "Index Text"}
                </Button>
              </InputGroup>
            </Form>
            {indexed > 0 && <Badge bg="success" className="fs-6">✅ {indexed} chunks indexed (Hybrid BM25 + Vector)</Badge>}
            {msg.text && <Alert variant={msg.type} className="mt-2 py-2">{msg.text}</Alert>}
          </Col>
          <Col md={6}>
            <h6 className="fw-bold">Step 2 — Search</h6>
            <Form onSubmit={search}>
              <InputGroup className="mb-3">
                <Form.Control value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search indexed text..." disabled={indexed === 0 || loading} />
                <Button type="submit" style={{ borderColor: "#6f42c1", color: "#6f42c1" }} variant="outline-secondary" disabled={indexed === 0 || loading}>
                  {loading ? <Spinner animation="border" size="sm" /> : "Search"}
                </Button>
              </InputGroup>
            </Form>
            {results.length > 0 && results.map((r, i) => (
              <Card key={i} className="mb-2 border-start border-4" style={{ borderColor: "#6f42c1" }}>
                <Card.Body className="py-2">
                  <Badge bg="secondary" className="mb-1">Score: {r.score.toFixed(4)}</Badge>
                  <p className="mb-0 small" style={{ whiteSpace: "pre-wrap" }}>{r.text}</p>
                </Card.Body>
              </Card>
            ))}
            {indexed === 0 && <p className="text-muted small">Index some text first to enable search.</p>}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5" }}>
      <nav className="navbar navbar-dark bg-dark px-4 py-3 mb-4 shadow">
        <span className="navbar-brand fw-bold fs-4">🤖 AI Tools Dashboard</span>
        <span className="text-secondary small">Powered by Groq + Llama 4</span>
      </nav>

      <Container fluid className="px-4">
        <Tabs defaultActiveKey="chat" className="mb-3" fill>
          <Tab eventKey="chat" title="💬 Chat">
            <ChatTab />
          </Tab>
          <Tab eventKey="price" title="💰 Live Prices">
            <PriceTab />
          </Tab>
          <Tab eventKey="image" title="🖼️ Image AI">
            <ImageTab />
          </Tab>
          <Tab eventKey="document" title="📄 PDF/Doc AI">
            <DocumentTab />
          </Tab>
          <Tab eventKey="editor" title="📝 Text Editor">
            <EditorTab />
          </Tab>
          <Tab eventKey="search" title="🔍 Web Search">
            <SearchTab />
          </Tab>
          <Tab eventKey="rag" title="📚 RAG">
            <RagTab />
          </Tab>
        </Tabs>
      </Container>
    </div>
  );
}
