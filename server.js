// Some of these lines were suggested by ChatGPT and VSC AI, but I customized and rewrote the comments myself to understand each part better.

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const TASTEDIVE_KEY = process.env.TASTEDIVE_KEY;

// I learned hiding my api keys from the Harold's tutorial (https://www.youtube.com/watch?v=zh88KYWSlps&t=1s) with .env files outside the codebase.
// If the key is missing, I stop the server immediately to avoid confusing errors.
if (!TASTEDIVE_KEY) {
  console.error("❌ Missing TASTEDIVE_KEY in .env");
  process.exit(1);
}

app.use(cors());
app.use(express.json());

// This middleware disables caching for all routes.
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// I set up Express to serve all files inside /public as static assets (HTML, JS, CSS).
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// This route acts as a middleman between the frontend and the TasteDive API.
// I did this to avoid CORS issues and to keep my API key safe on the server side.
app.get("/api/recommend", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 18), 1), 30);
    if (!q) return res.status(400).json({ error: "Missing query param ?q=" });

    // I used URLSearchParams here because it automatically encodes values.
    // Reference: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
    const params = new URLSearchParams({
      q,
      type: "music",
      info: "1",
      limit: String(limit),
      k: TASTEDIVE_KEY,
    });

    const url = `https://tastedive.com/api/similar?${params.toString()}`;
    console.log("→ Fetching from TasteDive:", url);

    // I used fetch() on the backend since Node 18+ supports it natively.
    // I added a custom User-Agent header because some APIs reject empty ones as ChatGPT suggested.
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "*/*",
      },
    });

    const text = await r.text();
    if (!r.ok) {
      console.error("TasteDive error:", r.status, text.slice(0, 200));
      return res.status(r.status).send(text);
    }

    // I added this try/catch to handle malformed JSON from APIs.
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("⚠️ Failed to parse JSON, sending raw text");
      return res.type("text").send(text);
    }

    // TasteDive sometimes returns "Similar" or "similar" keys depending on casing,
    // so I handle both to avoid undefined errors.
    const root = data.Similar || data.similar || data;
    const infoCount = Array.isArray(root?.Info || root?.info)
      ? (root.Info || root.info).length
      : 0;
    const resultCount = Array.isArray(root?.Results || root?.results)
      ? (root.Results || root.results).length
      : 0;

    console.log(
      `✓ TasteDive parsed successfully → Info=${infoCount}, Results=${resultCount}`
    );

    res.setHeader("Content-Type", "application/json");
    res.json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// I created this debug route so I can quickly check what TasteDive returns directly from the server.
// It’s not used by the frontend, but it helps me test URLs manually.
app.get("/api/debug", async (_req, res) => {
  try {
    const q = "Madeon";
    const params = new URLSearchParams({
      q,
      type: "music",
      info: "1",
      limit: "5",
      k: TASTEDIVE_KEY,
    });
    const url = `https://tastedive.com/api/similar?${params.toString()}`;
    console.log("→ Testing TasteDive URL:", url);

    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
    });
    const text = await r.text();
    console.log(
      "→ Raw TasteDive response (first 400 chars):",
      text.slice(0, 400)
    );
    res.type("text").send(text);
  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).send("Debug error");
  }
});

// Server Start
app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
  console.log(`   Serving static files from: ${PUBLIC_DIR}`);
});
