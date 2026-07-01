import express from "express";
import http from "http";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

// Initialize Gemini API
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function generateBotResponseWithFallback(prompt: string): Promise<any> {
  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });
        const text = response.text || "";
        return JSON.parse(text.trim());
      } catch (err: any) {
        lastError = err;
        console.warn(`Attempt ${attempt} using ${model} failed for bot speech:`, err?.message || err);
        // Wait briefly (backoff)
        await new Promise(resolve => setTimeout(resolve, attempt * 600));
      }
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  
  // CORS & Body parser
  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Bot speech generation API
  app.post("/api/bot-speech", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "Gemini API key is not configured on the server." });
    }

    try {
      const parsed = await generateBotResponseWithFallback(prompt);
      return res.json(parsed);
    } catch (error: any) {
      console.error("Gemini API call failed:", error);
      return res.status(500).json({ error: error?.message || "Gemini API generation failed" });
    }
  });

  // Integrate Vite for dev, or serve static assets in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
