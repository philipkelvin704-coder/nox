import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    app: "NOX TRADE",
    backend: "online",
    marketData: "Deriv public WebSocket",
    providers: { deriv: "active-symbol discovery and historical candles via deriv.js" },
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found. NOX market data is requested directly from Deriv." });
});

app.listen(PORT, () => {
  console.log(`NOX TRADE backend running at http://localhost:${PORT}`);
});
