import { useState, useEffect, useRef } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Container, Row, Col, Card, Tab, Tabs, Form, Button,
  Badge, Spinner, Alert, ListGroup, InputGroup, Table,
} from "react-bootstrap";

// ── Chat Tab ─────────────────────────────────────────────────────────────
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
    setMessages(updated); setInput(""); setLoading(true); setStreamingMsg("");
    try {
      const res = await fetch("/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: updated }) });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", assembled = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === "text") { assembled += chunk.text; setStreamingMsg(assembled); }
          else if (chunk.type === "tool_start") { assembled += `\n🔧 Tool: ${chunk.name}\n`; setStreamingMsg(assembled); }
          else if (chunk.type === "tool_result") { assembled += `✅ ${chunk.result}\n\n`; setStreamingMsg(assembled); }
          else if (chunk.type === "done") { setMessages(p => [...p, { role: "assistant", content: assembled }]); setStreamingMsg(""); fetchReminders(); }
          else if (chunk.type === "error") { setMessages(p => [...p, { role: "assistant", content: `Error: ${chunk.message}`, error: true }]); setStreamingMsg(""); }
        }
      }
    } catch (err) { setMessages(p => [...p, { role: "assistant", content: `Error: ${err.message}`, error: true }]); setStreamingMsg(""); }
    finally { setLoading(false); }
  }

  return (
    <Row className="g-3">
      <Col md={8} className="d-flex flex-column">
        <Card className="shadow-sm">
          <Card.Header className="bg-primary text-white fw-bold">💬 AI Chat — Tools Enabled</Card.Header>
          <Card.Body className="overflow-auto" style={{ maxHeight: "60vh" }}>
            {messages.length === 0 && (
              <div className="text-center text-muted mt-4">
                <p>👋 Try:</p>
                {["What is today gold price?", "What is Bitcoin price?", "What is today date?", "Save note: Meeting at 3pm", "Show all tasks from database"].map(s => (
                  <p key={s}><code style={{ cursor: "pointer" }} onClick={() => setInput(s)}>{s}</code></p>
                ))}
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
            {streamingMsg && <div className="d-flex justify-content-start mb-3"><div className="px-3 py-2 rounded-3 bg-light border" style={{ maxWidth: "75%", whiteSpace: "pre-wrap" }}><small className="fw-bold d-block mb-1">🤖 AI</small>{streamingMsg}</div></div>}
            {loading && !streamingMsg && <div className="d-flex justify-content-start mb-3"><div className="px-3 py-2 rounded-3 bg-light border"><Spinner animation="border" size="sm" className="me-2" />Thinking...</div></div>}
            <div ref={bottomRef} />
          </Card.Body>
          <Card.Footer className="bg-white">
            <Form onSubmit={sendMessage}>
              <InputGroup>
                <Form.Control value={input} onChange={e => setInput(e.target.value)} placeholder="Ask anything — gold price, date, save data..." disabled={loading} />
                <Button type="submit" variant="primary" disabled={loading}>{loading ? <Spinner animation="border" size="sm" /> : "Send"}</Button>
              </InputGroup>
            </Form>
          </Card.Footer>
        </Card>
      </Col>
      <Col md={4}>
        <Card className="shadow-sm">
          <Card.Header className="bg-warning fw-bold">🔔 Reminders <Badge bg="secondary">{reminders.length}</Badge></Card.Header>
          <Card.Body className="overflow-auto" style={{ maxHeight: "65vh" }}>
            {reminders.length === 0 ? <p className="text-muted text-center mt-3">No reminders yet.</p>
              : <ListGroup variant="flush">{reminders.map(r => <ListGroup.Item key={r._id} className="px-0"><div className="fw-semibold">{r.content}</div><small className="text-muted">🕐 {r.timestamp}</small></ListGroup.Item>)}</ListGroup>}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}

// ── Live Price Tab ────────────────────────────────────────────────────────
function PriceTab() {
  const [symbol, setSymbol] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const quick = [{ l: "🥇 Gold", s: "GOLD" }, { l: "🥈 Silver", s: "SILVER" }, { l: "₿ BTC", s: "BTC" }, { l: "Ξ ETH", s: "ETH" }, { l: "◎ SOL", s: "SOL" }, { l: "🍎 AAPL", s: "AAPL" }, { l: "⚡ TSLA", s: "TSLA" }, { l: "📦 AMZN", s: "AMZN" }, { l: "🔷 XRP", s: "XRP" }, { l: "🐕 DOGE", s: "DOGE" }];

  async function fetch_(sym) {
    const s = (sym || symbol).trim(); if (!s) return;
    setLoading(true); setResult(""); setError("");
    try { const { data } = await axios.get(`/api/price/${s}`); setResult(data.result); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold text-white" style={{ background: "#e6a817" }}>💰 Live Prices — Metals, Crypto, Stocks</Card.Header>
      <Card.Body>
        <Form onSubmit={e => { e.preventDefault(); fetch_(); }} className="mb-3">
          <InputGroup>
            <Form.Control value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="GOLD, SILVER, BTC, ETH, AAPL, TSLA..." disabled={loading} />
            <Button type="submit" style={{ background: "#e6a817", border: "none" }} disabled={loading}>{loading ? <Spinner animation="border" size="sm" /> : "Get Price"}</Button>
          </InputGroup>
        </Form>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {quick.map(({ l, s }) => <Button key={s} size="sm" variant="outline-secondary" onClick={() => { setSymbol(s); fetch_(s); }}>{l}</Button>)}
        </div>
        {error && <Alert variant="danger">{error}</Alert>}
        {result && <Alert variant="success" className="fs-5 fw-semibold">📊 {result}</Alert>}
      </Card.Body>
    </Card>
  );
}

// ── Image Analysis Tab ────────────────────────────────────────────────────
function ImageTab() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [prompt, setPrompt] = useState("Describe this image in detail.");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function onFile(e) { const f = e.target.files[0]; if (!f) return; setFile(f); setPreview(URL.createObjectURL(f)); setResult(""); setError(""); }

  async function analyze(e) {
    e.preventDefault(); if (!file) return;
    setLoading(true); setResult(""); setError("");
    try {
      const fd = new FormData(); fd.append("image", file); fd.append("prompt", prompt);
      const { data } = await axios.post("/api/analyze/image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data.reply);
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-danger text-white fw-bold">🖼️ Image Analysis (Vision AI)</Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={5}>
            <Form onSubmit={analyze}>
              <Form.Group className="mb-2"><Form.Label className="fw-semibold">Upload Image</Form.Label><Form.Control type="file" accept="image/*" onChange={onFile} /></Form.Group>
              {preview && <div className="mb-2 text-center"><img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 8 }} /></div>}
              <Form.Group className="mb-2"><Form.Label className="fw-semibold">Prompt</Form.Label><Form.Control as="textarea" rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} /></Form.Group>
              <div className="d-flex flex-wrap gap-1 mb-2">
                {["Describe this image.", "What objects are visible?", "Analyze fire risk.", "Extract all text."].map(p => <Button key={p} size="sm" variant="outline-danger" onClick={() => setPrompt(p)}>{p}</Button>)}
              </div>
              <Button type="submit" variant="danger" disabled={!file || loading} className="w-100">{loading ? <><Spinner animation="border" size="sm" className="me-2" />Analyzing...</> : "🔍 Analyze"}</Button>
            </Form>
          </Col>
          <Col md={7}>
            {error && <Alert variant="danger">{error}</Alert>}
            {result ? <Card className="border-0 bg-light"><Card.Header className="fw-bold bg-light">🤖 Result</Card.Header><Card.Body style={{ whiteSpace: "pre-wrap", maxHeight: "50vh", overflowY: "auto" }}>{result}</Card.Body></Card>
              : <div className="text-center text-muted mt-5"><p>📷 Upload an image and click Analyze</p><p className="small">JPG, PNG, GIF, WebP — Max 20MB</p></div>}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── Document Analysis Tab ─────────────────────────────────────────────────
function DocumentTab() {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState("Summarize this document.");
  const [result, setResult] = useState("");
  const [chars, setChars] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze(e) {
    e.preventDefault(); if (!file) return;
    setLoading(true); setResult(""); setError("");
    try {
      const fd = new FormData(); fd.append("document", file); fd.append("prompt", prompt);
      const { data } = await axios.post("/api/analyze/document", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data.reply); setChars(data.chars || 0);
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-secondary text-white fw-bold">📄 Document / PDF Analysis</Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={5}>
            <Form onSubmit={analyze}>
              <Form.Group className="mb-2"><Form.Label className="fw-semibold">Upload File (PDF, Word, TXT, CSV)</Form.Label>
                <Form.Control type="file" accept=".pdf,.txt,.csv,.json,.md,.docx,.doc" onChange={e => { const f = e.target.files[0]; if (f) { setFile(f); setResult(""); setError(""); } }} />
                {file && <Form.Text className="text-muted">📁 {file.name} ({(file.size / 1024).toFixed(1)} KB)</Form.Text>}
              </Form.Group>
              <Form.Group className="mb-2"><Form.Label className="fw-semibold">Prompt</Form.Label><Form.Control as="textarea" rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} /></Form.Group>
              <div className="d-flex flex-wrap gap-1 mb-2">
                {["Summarize this document.", "Extract key points.", "List all important data.", "What are the main topics?"].map(p => <Button key={p} size="sm" variant="outline-secondary" onClick={() => setPrompt(p)}>{p}</Button>)}
              </div>
              <Button type="submit" variant="secondary" disabled={!file || loading} className="w-100">{loading ? <><Spinner animation="border" size="sm" className="me-2" />Analyzing...</> : "🔍 Analyze"}</Button>
            </Form>
          </Col>
          <Col md={7}>
            {error && <Alert variant="danger">{error}</Alert>}
            {chars > 0 && <Alert variant="info" className="py-1 small">📊 Extracted {chars.toLocaleString()} characters</Alert>}
            {result ? <Card className="border-0 bg-light"><Card.Header className="fw-bold bg-light">🤖 Result</Card.Header><Card.Body style={{ whiteSpace: "pre-wrap", maxHeight: "50vh", overflowY: "auto" }}>{result}</Card.Body></Card>
              : <div className="text-center text-muted mt-5"><p>📄 Upload a document and click Analyze</p><p className="small">PDF, Word, TXT, CSV, JSON, MD — Max 20MB</p></div>}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── File Manager Tab (FileController) ─────────────────────────────────────
function FileManagerTab() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [prompt, setPrompt] = useState("Summarize this document.");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadFiles(); }, []);

  async function loadFiles() {
    try { const { data } = await axios.get("/api/files"); setFiles(data); } catch {}
  }

  async function uploadFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      await axios.post("/api/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await loadFiles();
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setUploading(false); }
  }

  async function deleteFile(id) {
    try { await axios.delete(`/api/files/${id}`); await loadFiles(); if (selectedId === id) setSelectedId(""); } catch {}
  }

  async function queryFile(e) {
    e.preventDefault(); if (!selectedId) return;
    setLoading(true); setResult(""); setError("");
    try {
      const { data } = await axios.post(`/api/files/${selectedId}/query`, { prompt });
      setResult(data.reply);
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold text-white" style={{ background: "#0d6efd" }}>📁 File Manager — Upload Once, Reuse Anytime</Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={4}>
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">Upload New File</Form.Label>
              <Form.Control type="file" accept=".pdf,.txt,.csv,.json,.md,.docx" onChange={uploadFile} disabled={uploading} />
              {uploading && <div className="mt-1"><Spinner animation="border" size="sm" className="me-1" />Uploading...</div>}
            </Form.Group>
            <h6 className="fw-bold">Uploaded Files ({files.length})</h6>
            {files.length === 0 ? <p className="text-muted small">No files uploaded yet.</p>
              : <ListGroup variant="flush">
                {files.map(f => (
                  <ListGroup.Item key={f.fileId} action active={selectedId === f.fileId} onClick={() => setSelectedId(f.fileId)} className="d-flex justify-content-between align-items-start py-2">
                    <div>
                      <div className="fw-semibold small">{f.name}</div>
                      <small className="text-muted">{f.chars?.toLocaleString()} chars</small>
                    </div>
                    <Button size="sm" variant="outline-danger" onClick={e => { e.stopPropagation(); deleteFile(f.fileId); }}>🗑</Button>
                  </ListGroup.Item>
                ))}
              </ListGroup>}
          </Col>
          <Col md={8}>
            <Form onSubmit={queryFile}>
              <Form.Group className="mb-2">
                <Form.Label className="fw-semibold">Ask about selected file</Form.Label>
                <Form.Control as="textarea" rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!selectedId} />
              </Form.Group>
              <div className="d-flex flex-wrap gap-1 mb-2">
                {["Summarize this document.", "Extract key points.", "List all data.", "Answer questions from this file."].map(p => <Button key={p} size="sm" variant="outline-primary" onClick={() => setPrompt(p)} disabled={!selectedId}>{p}</Button>)}
              </div>
              <Button type="submit" variant="primary" disabled={!selectedId || loading} className="w-100">
                {loading ? <><Spinner animation="border" size="sm" className="me-2" />Processing...</> : "🤖 Query File"}
              </Button>
            </Form>
            {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
            {result && <Card className="mt-2 border-0 bg-light"><Card.Header className="fw-bold bg-light">🤖 Result</Card.Header><Card.Body style={{ whiteSpace: "pre-wrap", maxHeight: "40vh", overflowY: "auto" }}>{result}</Card.Body></Card>}
            {!selectedId && <div className="text-center text-muted mt-4"><p>📁 Upload a file and select it to query</p></div>}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── Eval Tab (EvalController) ─────────────────────────────────────────────
function EvalTab() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [context, setContext] = useState("");
  const [evalResult, setEvalResult] = useState(null);
  const [genText, setGenText] = useState("");
  const [genCount, setGenCount] = useState(5);
  const [dataset, setDataset] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function evaluate(e) {
    e.preventDefault(); if (!question || !answer) return;
    setLoading(true); setEvalResult(null); setError("");
    try { const { data } = await axios.post("/api/eval", { question, answer, context }); setEvalResult(data); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function generateDataset(e) {
    e.preventDefault(); if (!genText) return;
    setLoading(true); setDataset([]); setError("");
    try { const { data } = await axios.post("/api/eval/generate-dataset", { text: genText, count: genCount }); setDataset(data.dataset || []); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  const scoreColor = s => s >= 4 ? "success" : s >= 3 ? "warning" : "danger";

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold text-white" style={{ background: "#6610f2" }}>🧪 Eval — AI Answer Evaluation & Dataset Generation</Card.Header>
      <Card.Body>
        <Tabs defaultActiveKey="evaluate" className="mb-3">
          <Tab eventKey="evaluate" title="📊 Evaluate Answer">
            <Form onSubmit={evaluate}>
              <Row className="g-2">
                <Col md={6}><Form.Label className="fw-semibold">Question</Form.Label><Form.Control as="textarea" rows={2} value={question} onChange={e => setQuestion(e.target.value)} placeholder="What is machine learning?" /></Col>
                <Col md={6}><Form.Label className="fw-semibold">Answer to Evaluate</Form.Label><Form.Control as="textarea" rows={2} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Machine learning is..." /></Col>
                <Col md={12}><Form.Label className="fw-semibold">Context (optional)</Form.Label><Form.Control as="textarea" rows={2} value={context} onChange={e => setContext(e.target.value)} placeholder="Optional reference context..." /></Col>
              </Row>
              <Button type="submit" className="mt-2" style={{ background: "#6610f2", border: "none" }} disabled={!question || !answer || loading}>
                {loading ? <><Spinner animation="border" size="sm" className="me-2" />Evaluating...</> : "🧪 Evaluate"}
              </Button>
            </Form>
            {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
            {evalResult && !evalResult.raw && (
              <div className="mt-3">
                <Row className="g-2 mb-2">
                  {["accuracy", "completeness", "clarity", "overall"].map(k => (
                    <Col key={k} xs={3}><Card className={`text-center border-0 bg-${scoreColor(evalResult[k])}-subtle`}><Card.Body className="py-2"><div className="fs-3 fw-bold">{evalResult[k]}/5</div><small className="text-capitalize">{k}</small></Card.Body></Card></Col>
                  ))}
                </Row>
                <Alert variant="info"><strong>Feedback:</strong> {evalResult.feedback}</Alert>
              </div>
            )}
            {evalResult?.raw && <Alert variant="secondary" className="mt-2" style={{ whiteSpace: "pre-wrap" }}>{evalResult.raw}</Alert>}
          </Tab>
          <Tab eventKey="dataset" title="📋 Generate Dataset">
            <Form onSubmit={generateDataset}>
              <Row className="g-2">
                <Col md={10}><Form.Label className="fw-semibold">Source Text</Form.Label><Form.Control as="textarea" rows={4} value={genText} onChange={e => setGenText(e.target.value)} placeholder="Paste any text to generate Q&A pairs from it..." /></Col>
                <Col md={2}><Form.Label className="fw-semibold">Count</Form.Label><Form.Control type="number" min={1} max={20} value={genCount} onChange={e => setGenCount(+e.target.value)} /></Col>
              </Row>
              <Button type="submit" className="mt-2" style={{ background: "#6610f2", border: "none" }} disabled={!genText || loading}>
                {loading ? <><Spinner animation="border" size="sm" className="me-2" />Generating...</> : "📋 Generate Q&A Dataset"}
              </Button>
            </Form>
            {dataset.length > 0 && (
              <Table striped bordered hover size="sm" className="mt-3">
                <thead><tr><th>#</th><th>Type</th><th>Question</th><th>Answer</th></tr></thead>
                <tbody>{dataset.map((d, i) => <tr key={i}><td>{i + 1}</td><td><Badge bg="secondary">{d.type}</Badge></td><td>{d.question}</td><td>{d.answer}</td></tr>)}</tbody>
              </Table>
            )}
          </Tab>
        </Tabs>
      </Card.Body>
    </Card>
  );
}

// ── Workflow Tab (WorkflowController) ─────────────────────────────────────
function WorkflowTab() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("route");

  // Chain steps
  const [steps, setSteps] = useState([{ prompt: "Summarize the input in 3 bullet points.", system: "" }, { prompt: "Translate the above to formal English.", system: "" }]);

  // Parallel prompts
  const [prompts, setPrompts] = useState(["Summarize in 2 sentences.", "Extract 3 key points.", "Suggest 2 improvements."]);

  async function run(e) {
    e.preventDefault(); if (!input.trim()) return;
    setLoading(true); setResult(null); setError("");
    try {
      let data;
      if (mode === "route") ({ data } = await axios.post("/api/workflow/route", { input }));
      else if (mode === "chain") ({ data } = await axios.post("/api/workflow/chain", { input, steps }));
      else if (mode === "parallel") ({ data } = await axios.post("/api/workflow/parallel", { input, prompts }));
      setResult(data);
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold text-white" style={{ background: "#198754" }}>⚙️ Workflow — Chain, Parallel, Route</Card.Header>
      <Card.Body>
        <Form onSubmit={run}>
          <Row className="g-2 mb-3">
            <Col md={8}><Form.Label className="fw-semibold">Input</Form.Label><Form.Control as="textarea" rows={3} value={input} onChange={e => setInput(e.target.value)} placeholder="Enter your input text or question..." /></Col>
            <Col md={4}>
              <Form.Label className="fw-semibold">Mode</Form.Label>
              <Form.Select value={mode} onChange={e => setMode(e.target.value)}>
                <option value="route">🔀 Route — AI picks best agent</option>
                <option value="chain">🔗 Chain — Sequential steps</option>
                <option value="parallel">⚡ Parallel — Multiple prompts at once</option>
              </Form.Select>
            </Col>
          </Row>

          {mode === "chain" && (
            <div className="mb-3">
              <label className="fw-semibold mb-1">Chain Steps</label>
              {steps.map((s, i) => (
                <Row key={i} className="g-1 mb-1 align-items-center">
                  <Col xs={1}><Badge bg="secondary">{i + 1}</Badge></Col>
                  <Col xs={8}><Form.Control size="sm" value={s.prompt} onChange={e => { const ns = [...steps]; ns[i].prompt = e.target.value; setSteps(ns); }} placeholder="Step prompt..." /></Col>
                  <Col xs={2}><Form.Control size="sm" value={s.system} onChange={e => { const ns = [...steps]; ns[i].system = e.target.value; setSteps(ns); }} placeholder="System (opt)" /></Col>
                  <Col xs={1}><Button size="sm" variant="outline-danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</Button></Col>
                </Row>
              ))}
              <Button size="sm" variant="outline-success" onClick={() => setSteps([...steps, { prompt: "", system: "" }])}>+ Add Step</Button>
            </div>
          )}

          {mode === "parallel" && (
            <div className="mb-3">
              <label className="fw-semibold mb-1">Parallel Prompts</label>
              {prompts.map((p, i) => (
                <Row key={i} className="g-1 mb-1 align-items-center">
                  <Col xs={1}><Badge bg="info">{i + 1}</Badge></Col>
                  <Col xs={10}><Form.Control size="sm" value={p} onChange={e => { const np = [...prompts]; np[i] = e.target.value; setPrompts(np); }} placeholder="Prompt..." /></Col>
                  <Col xs={1}><Button size="sm" variant="outline-danger" onClick={() => setPrompts(prompts.filter((_, j) => j !== i))}>✕</Button></Col>
                </Row>
              ))}
              <Button size="sm" variant="outline-info" onClick={() => setPrompts([...prompts, ""])}>+ Add Prompt</Button>
            </div>
          )}

          <Button type="submit" style={{ background: "#198754", border: "none" }} disabled={!input.trim() || loading}>
            {loading ? <><Spinner animation="border" size="sm" className="me-2" />Running...</> : "▶ Run Workflow"}
          </Button>
        </Form>

        {error && <Alert variant="danger" className="mt-3">{error}</Alert>}

        {result && (
          <div className="mt-3">
            {mode === "route" && (
              <>
                <Alert variant="info">🔀 Routed to: <strong>{result.category}</strong> — {result.reason}</Alert>
                <Card className="border-0 bg-light"><Card.Body style={{ whiteSpace: "pre-wrap" }}>{result.reply}</Card.Body></Card>
              </>
            )}
            {mode === "chain" && (
              <>
                {result.steps?.map((s, i) => <Card key={i} className="mb-2 border-start border-4 border-success"><Card.Body><Badge bg="success" className="mb-1">Step {i + 1}</Badge><p className="small text-muted mb-1">{s.step}</p><div style={{ whiteSpace: "pre-wrap" }}>{s.output}</div></Card.Body></Card>)}
              </>
            )}
            {mode === "parallel" && (
              <Row className="g-2">
                {result.results?.map((r, i) => <Col key={i} md={4}><Card className="h-100 border-start border-4 border-info"><Card.Body><Badge bg="info" className="mb-1">Task {i + 1}</Badge><p className="small text-muted mb-1">{r.prompt}</p><div style={{ whiteSpace: "pre-wrap", fontSize: "0.9em" }}>{r.output}</div></Card.Body></Card></Col>)}
              </Row>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

// ── DB Tool Tab (ToolController) ──────────────────────────────────────────
function DbTab() {
  const [query, setQuery] = useState("SELECT * FROM notes");
  const [result, setResult] = useState(null);
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadSchema(); }, []);

  async function loadSchema() {
    try { const { data } = await axios.get("/api/tools/db/tables"); setSchema(data); } catch {}
  }

  async function runQuery(e) {
    e.preventDefault(); if (!query.trim()) return;
    setLoading(true); setResult(null); setError("");
    try { const { data } = await axios.post("/api/tools/db", { query }); setResult(data.result); }
    catch (err) { setError(err.response?.data?.error || err.message); } finally { setLoading(false); }
  }

  const quickQueries = ["SELECT * FROM notes", "SELECT * FROM tasks", "INSERT INTO notes (title, content, created_at) VALUES ('New Note', 'Content here', datetime('now'))", "INSERT INTO tasks (task, status, created_at) VALUES ('New task', 'pending', datetime('now'))", "SELECT COUNT(*) as total FROM notes"];

  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold text-white" style={{ background: "#dc3545" }}>🗄️ Database Tool (SQLite)</Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={3}>
            <h6 className="fw-bold">Schema</h6>
            {schema ? schema.tables.map(t => (
              <Card key={t} className="mb-2 border-0 bg-light">
                <Card.Body className="py-2"><div className="fw-semibold small">📋 {t}</div>{schema.schema[t]?.map(c => <div key={c.name} className="small text-muted">{c.name} <span className="text-secondary">({c.type})</span></div>)}</Card.Body>
              </Card>
            )) : <Spinner animation="border" size="sm" />}
            <h6 className="fw-bold mt-2">Quick Queries</h6>
            {quickQueries.map(q => <Button key={q} size="sm" variant="outline-secondary" className="d-block mb-1 text-start w-100 text-truncate" onClick={() => setQuery(q)} title={q}>{q}</Button>)}
          </Col>
          <Col md={9}>
            <Form onSubmit={runQuery}>
              <Form.Group className="mb-2"><Form.Label className="fw-semibold">SQL Query</Form.Label>
                <Form.Control as="textarea" rows={3} value={query} onChange={e => setQuery(e.target.value)} placeholder="SELECT * FROM notes" style={{ fontFamily: "monospace" }} />
              </Form.Group>
              <Button type="submit" variant="danger" disabled={loading}>{loading ? <><Spinner animation="border" size="sm" className="me-2" />Running...</> : "▶ Run Query"}</Button>
            </Form>
            {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
            {result && (
              <div className="mt-2">
                {Array.isArray(result) && result.length > 0 ? (
                  <Table striped bordered hover size="sm" responsive>
                    <thead><tr>{Object.keys(result[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>{result.map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody>
                  </Table>
                ) : <Alert variant="success"><pre className="mb-0">{JSON.stringify(result, null, 2)}</pre></Alert>}
              </div>
            )}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── Editor Tab ────────────────────────────────────────────────────────────
function EditorTab() {
  const [messages, setMessages] = useState([]);
  const [editorMsgs, setEditorMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(e) {
    e.preventDefault(); if (!input.trim()) return;
    const nm = [...editorMsgs, { role: "user", content: input }];
    setMessages(p => [...p, { role: "user", content: input }]); setInput(""); setLoading(true);
    try {
      const { data } = await axios.post("/api/editor", { messages: nm });
      setEditorMsgs(data.messages || nm);
      setMessages(p => [...p, { role: "assistant", content: data.reply || data.error }]);
    } catch (err) { setMessages(p => [...p, { role: "assistant", content: `Error: ${err.message}`, error: true }]); }
    finally { setLoading(false); }
  }

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-success text-white fw-bold">📝 File Editor</Card.Header>
      <Card.Body>
        <div className="overflow-auto mb-3 p-2 border rounded bg-light" style={{ minHeight: 200, maxHeight: "50vh" }}>
          {messages.length === 0 && <p className="text-muted text-center mt-3">Try: <code>Create a file called notes.txt with content Hello World</code></p>}
          {messages.map((m, i) => <div key={i} className={`d-flex mb-2 ${m.role === "user" ? "justify-content-end" : "justify-content-start"}`}><div className={`px-3 py-2 rounded-3 ${m.role === "user" ? "bg-success text-white" : m.error ? "bg-danger text-white" : "bg-white border"}`} style={{ maxWidth: "80%", whiteSpace: "pre-wrap" }}><small className="fw-bold d-block mb-1">{m.role === "user" ? "You" : "🤖 AI"}</small>{m.content}</div></div>)}
          {loading && <div className="d-flex justify-content-start"><div className="px-3 py-2 rounded-3 bg-white border"><Spinner animation="border" size="sm" className="me-2" />Working...</div></div>}
          <div ref={bottomRef} />
        </div>
        <Form onSubmit={send}><InputGroup><Form.Control value={input} onChange={e => setInput(e.target.value)} placeholder='e.g. "Create notes.txt with Hello World"' disabled={loading} /><Button type="submit" variant="success" disabled={loading}>{loading ? <Spinner animation="border" size="sm" /> : "Send"}</Button></InputGroup></Form>
      </Card.Body>
    </Card>
  );
}

// ── Search Tab ────────────────────────────────────────────────────────────
function SearchTab() {
  const [query, setQuery] = useState(""); const [result, setResult] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  async function search(e) {
    e.preventDefault(); if (!query.trim()) return;
    setLoading(true); setResult(null); setError("");
    try { const { data } = await axios.post("/api/search", { query }); if (data.error) setError(data.error); else setResult(data); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-info text-white fw-bold">🔍 Web Search</Card.Header>
      <Card.Body>
        <Form onSubmit={search} className="mb-3"><InputGroup><Form.Control value={query} onChange={e => setQuery(e.target.value)} placeholder="What is machine learning?" disabled={loading} size="lg" /><Button type="submit" variant="info" disabled={loading} className="text-white">{loading ? <><Spinner animation="border" size="sm" className="me-2" />Searching...</> : "Search"}</Button></InputGroup></Form>
        {error && <Alert variant="danger">{error}</Alert>}
        {result && <><Card className="mb-3 border-0 bg-light"><Card.Body style={{ whiteSpace: "pre-wrap" }}>{result.reply}</Card.Body></Card>{result.sources?.length > 0 && <ListGroup>{result.sources.map((s, i) => <ListGroup.Item key={i} action href={s.url} target="_blank" rel="noreferrer">🔗 {s.title}</ListGroup.Item>)}</ListGroup>}</>}
      </Card.Body>
    </Card>
  );
}

// ── RAG Tab ───────────────────────────────────────────────────────────────
function RagTab() {
  const [text, setText] = useState(""); const [method, setMethod] = useState("section"); const [query, setQuery] = useState(""); const [results, setResults] = useState([]); const [indexed, setIndexed] = useState(0); const [loading, setLoading] = useState(false); const [msg, setMsg] = useState({ text: "", type: "" });
  async function indexText(e) { e.preventDefault(); if (!text.trim()) return; setLoading(true); setMsg({ text: "", type: "" }); try { const { data } = await axios.post("/api/rag/index", { text, method }); if (data.error) setMsg({ text: data.error, type: "danger" }); else { setMsg({ text: data.message, type: "success" }); setIndexed(data.total); setText(""); } } catch (err) { setMsg({ text: err.message, type: "danger" }); } finally { setLoading(false); } }
  async function search(e) { e.preventDefault(); if (!query.trim()) return; setLoading(true); setMsg({ text: "", type: "" }); try { const { data } = await axios.post("/api/rag/search", { query, k: 3 }); if (data.error) setMsg({ text: data.error, type: "danger" }); else setResults(data.results); } catch (err) { setMsg({ text: err.message, type: "danger" }); } finally { setLoading(false); } }
  return (
    <Card className="shadow-sm">
      <Card.Header className="fw-bold" style={{ background: "#6f42c1", color: "white" }}>📚 RAG — Hybrid BM25 + Vector Search</Card.Header>
      <Card.Body>
        <Row className="g-4">
          <Col md={6}>
            <h6 className="fw-bold">Step 1 — Index Text</h6>
            <Form onSubmit={indexText}>
              <Form.Control as="textarea" rows={5} className="mb-2" value={text} onChange={e => setText(e.target.value)} placeholder={"Paste text...\n\n## Section 1\nContent...\n\n## Section 2\nMore content..."} />
              <InputGroup className="mb-2">
                <Form.Select value={method} onChange={e => setMethod(e.target.value)}><option value="section">By Section (##)</option><option value="sentence">By Sentence</option><option value="char">By Characters</option></Form.Select>
                <Button type="submit" style={{ background: "#6f42c1", color: "white", border: "none" }} disabled={loading}>{loading ? <Spinner animation="border" size="sm" /> : "Index"}</Button>
              </InputGroup>
            </Form>
            {indexed > 0 && <Badge bg="success">✅ {indexed} chunks indexed (Hybrid)</Badge>}
            {msg.text && <Alert variant={msg.type} className="mt-2 py-2">{msg.text}</Alert>}
          </Col>
          <Col md={6}>
            <h6 className="fw-bold">Step 2 — Search</h6>
            <Form onSubmit={search}>
              <InputGroup className="mb-3"><Form.Control value={query} onChange={e => setQuery(e.target.value)} placeholder="Search..." disabled={indexed === 0 || loading} /><Button type="submit" style={{ borderColor: "#6f42c1", color: "#6f42c1" }} variant="outline-secondary" disabled={indexed === 0 || loading}>{loading ? <Spinner animation="border" size="sm" /> : "Search"}</Button></InputGroup>
            </Form>
            {results.map((r, i) => <Card key={i} className="mb-2 border-start border-4" style={{ borderColor: "#6f42c1" }}><Card.Body className="py-2"><Badge bg="secondary" className="mb-1">Score: {r.score.toFixed(4)}</Badge><p className="mb-0 small" style={{ whiteSpace: "pre-wrap" }}>{r.text}</p></Card.Body></Card>)}
            {indexed === 0 && <p className="text-muted small">Index text first.</p>}
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5" }}>
      <nav className="navbar navbar-dark bg-dark px-4 py-3 mb-4 shadow">
        <span className="navbar-brand fw-bold fs-4">🤖 AI Tools Dashboard</span>
        <span className="text-secondary small">Groq + Llama 3.3 — All Tools Active</span>
      </nav>
      <Container fluid className="px-4">
        <Tabs defaultActiveKey="chat" className="mb-3" fill>
          <Tab eventKey="chat" title="💬 Chat">         <ChatTab /></Tab>
          <Tab eventKey="price" title="💰 Prices">      <PriceTab /></Tab>
          <Tab eventKey="image" title="🖼️ Image AI">    <ImageTab /></Tab>
          <Tab eventKey="document" title="📄 Doc AI">   <DocumentTab /></Tab>
          <Tab eventKey="files" title="📁 Files">       <FileManagerTab /></Tab>
          <Tab eventKey="eval" title="🧪 Eval">         <EvalTab /></Tab>
          <Tab eventKey="workflow" title="⚙️ Workflow"> <WorkflowTab /></Tab>
          <Tab eventKey="db" title="🗄️ Database">       <DbTab /></Tab>
          <Tab eventKey="editor" title="📝 Editor">     <EditorTab /></Tab>
          <Tab eventKey="search" title="🔍 Search">     <SearchTab /></Tab>
          <Tab eventKey="rag" title="📚 RAG">           <RagTab /></Tab>
        </Tabs>
      </Container>
    </div>
  );
}
