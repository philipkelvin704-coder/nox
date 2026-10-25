
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));
app.use(express.json());

const TIMEFRAMES = {
  "1m": { twelve: "1min", alpha: "1min", binance: "1m" },
  "3m": { twelve: null, alpha: null, binance: "3m" },
  "5m": { twelve: "5min", alpha: "5min", binance: "5m" },
  "15m": { twelve: "15min", alpha: "15min", binance: "15m" },
  "30m": { twelve: "30min", alpha: "30min", binance: "30m" },
  "1h": { twelve: "1h", alpha: "60min", binance: "1h" },
  "2h": { twelve: "2h", alpha: null, binance: "2h" },
  "4h": { twelve: "4h", alpha: null, binance: "4h" },
  "1D": { twelve: "1day", alpha: "daily", binance: "1d" },
  "1W": { twelve: "1week", alpha: "weekly", binance: "1w" },
  "1M": { twelve: "1month", alpha: "monthly", binance: "1M" },
};

app.get("/api/status", (_req, res) => {
  res.json({
    app: "NOX TRADE",
    backend: "online",
    providers: {
      twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
      alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      binance: "public market data",
      cryptoMarkets: "Binance public spot market data",
      cryptoNews: "Free Crypto News search",
      deriv: "handled separately by deriv.js",
    },
  });
});

function normalizeTimeframe(value) {
  const input = String(value || "15m").trim();

  if (Object.prototype.hasOwnProperty.call(TIMEFRAMES, input)) {
    return input;
  }

  const match = Object.keys(TIMEFRAMES).find(
    (key) => key.toLowerCase() === input.toLowerCase()
  );

  if (!match) {
    throw new Error(
      "Unsupported timeframe. Use 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, 1W or 1M."
    );
  }

  return match;
}

function normalizeSymbol(value) {
  const symbol = String(value || "").trim();

  if (!symbol || symbol.length > 80 || !/^[A-Za-z0-9/_-]+$/.test(symbol)) {
    throw new Error("Invalid market symbol.");
  }

  return symbol;
}

async function fetchJson(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Provider returned invalid JSON (HTTP ${response.status}): ${raw
        .slice(0, 160)
        .replace(/\s+/g, " ")}`
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.status?.error_message ||
      data?.message ||
      data?.msg ||
      JSON.stringify(data).slice(0, 250);

    throw new Error(`Provider request failed (${response.status}): ${message}`);
  }

  return data;
}

// ------------------------------ Twelve Data ------------------------------

function normalizeTwelveData(data) {
  if (!Array.isArray(data.values)) {
    throw new Error(
      data.message || data["Error Message"] || "Twelve Data returned no candles."
    );
  }

  return data.values
    .map((c) => ({
      time: new Date(c.datetime.replace(" ", "T") + "Z").toISOString(),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    )
    .reverse();
}

async function getTwelveDataCandles(symbol, timeframe, limit) {
  const interval = TIMEFRAMES[timeframe].twelve;

  if (!interval) {
    throw new Error(
      `Twelve Data does not have a configured native interval for ${timeframe}.`
    );
  }

  if (!process.env.TWELVE_DATA_API_KEY) {
    throw new Error("TWELVE_DATA_API_KEY is missing from .env.");
  }

  const url = new URL("https://api.twelvedata.com/time_series");

  url.searchParams.set("symbol", symbol.replace("-", "/"));
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(limit));
  url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

  return normalizeTwelveData(await fetchJson(url)).slice(-limit);
}

// ------------------------------ Alpha Vantage ------------------------------

function normalizeAlphaVantage(data) {
  const seriesKey = Object.keys(data).find((key) =>
    key.startsWith("Time Series FX")
  );

  if (!seriesKey) {
    throw new Error(
      data.Note ||
        data.Information ||
        data["Error Message"] ||
        "Alpha Vantage returned no candle series. Check the symbol, interval and API limits."
    );
  }

  return Object.entries(data[seriesKey])
    .map(([time, c]) => ({
      time: time.includes(" ")
        ? time.replace(" ", "T") + "Z"
        : time + "T00:00:00Z",
      open: Number(c["1. open"]),
      high: Number(c["2. high"]),
      low: Number(c["3. low"]),
      close: Number(c["4. close"]),
    }))
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    )
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

async function getAlphaVantageCandles(symbol, timeframe, limit) {
  const interval = TIMEFRAMES[timeframe].alpha;

  if (!interval) {
    throw new Error(
      `Alpha Vantage's configured FX intervals do not support ${timeframe}.`
    );
  }

  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    throw new Error("ALPHA_VANTAGE_API_KEY is missing from .env.");
  }

  const pair = symbol.replace(/[^A-Za-z]/g, "").toUpperCase();

  if (!/^[A-Z]{6}$/.test(pair)) {
    throw new Error(
      "Alpha Vantage FX candles require a six-letter pair such as EURUSD."
    );
  }

  const url = new URL("https://www.alphavantage.co/query");

  url.searchParams.set("from_symbol", pair.slice(0, 3));
  url.searchParams.set("to_symbol", pair.slice(3, 6));
  url.searchParams.set("apikey", process.env.ALPHA_VANTAGE_API_KEY);

  if (["daily", "weekly", "monthly"].includes(interval)) {
    url.searchParams.set("function", `FX_${interval.toUpperCase()}`);
  } else {
    url.searchParams.set("function", "FX_INTRADAY");
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", limit > 100 ? "full" : "compact");
  }

  return normalizeAlphaVantage(await fetchJson(url)).slice(-limit);
}

// ------------------------------ Binance ------------------------------

function normalizeBinance(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Binance returned an unexpected candle response.");
  }

  return rows
    .map((c) => ({
      time: new Date(Number(c[0])).toISOString(),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
    }))
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    );
}

async function getBinanceCandles(symbol, timeframe, limit) {
  const url = new URL("https://api.binance.com/api/v3/klines");

  url.searchParams.set(
    "symbol",
    symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  );
  url.searchParams.set("interval", TIMEFRAMES[timeframe].binance);
  url.searchParams.set("limit", String(Math.min(limit, 1000)));

  const data = await fetchJson(url);

  if (!Array.isArray(data)) {
    throw new Error(data.msg || "Binance could not return these candles.");
  }

  return normalizeBinance(data);
}

// ------------------------------ Binance markets ------------------------------

app.get("/api/binance/markets", async (_req, res) => {
  try {
    const [exchangeInfo, tickerData] = await Promise.all([
      fetchJson("https://api.binance.com/api/v3/exchangeInfo"),
      fetchJson("https://api.binance.com/api/v3/ticker/24hr"),
    ]);

    if (!Array.isArray(exchangeInfo.symbols) || !Array.isArray(tickerData)) {
      throw new Error("Binance returned an unexpected market-list format.");
    }

    const prices = new Map(
      tickerData.map((ticker) => [ticker.symbol, ticker])
    );

    const markets = exchangeInfo.symbols
      .filter(
        (item) =>
          item.status === "TRADING" &&
          item.quoteAsset === "USDT" &&
          item.isSpotTradingAllowed === true
      )
      .map((item) => {
        const ticker = prices.get(item.symbol);

        if (!ticker) return null;

        return {
          id: item.baseAsset,
          name: item.baseAsset,
          symbol: item.baseAsset,
          currentPrice: Number(ticker.lastPrice),
          marketCapRank: null,
          quoteVolume: Number(ticker.quoteVolume || 0),
          exchangeSymbol: item.symbol,
        };
      })
      .filter(
        (item) =>
          item &&
          Number.isFinite(item.currentPrice) &&
          Number.isFinite(item.quoteVolume)
      )
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 100);

    res.json({ provider: "binance", count: markets.length, markets });
  } catch (error) {
    console.error("Binance market-list request failed:", error.message);

    res.status(502).json({
      error: error.message || "Unable to retrieve Binance crypto markets.",
      markets: [],
    });
  }
});

// ------------------------------ Shared candle endpoint ------------------------------

app.get("/api/candles", async (req, res) => {
  try {
    const provider = String(req.query.provider || "").toLowerCase();
    const symbol = normalizeSymbol(req.query.symbol);
    const timeframe = normalizeTimeframe(req.query.timeframe || "15m");

    const parsedLimit = Number.parseInt(req.query.limit || "100", 10);
    const limit = Math.min(
      500,
      Math.max(20, Number.isFinite(parsedLimit) ? parsedLimit : 100)
    );

    let candles;

    if (provider === "twelvedata") {
      candles = await getTwelveDataCandles(symbol, timeframe, limit);
    } else if (provider === "alphavantage") {
      candles = await getAlphaVantageCandles(symbol, timeframe, limit);
    } else if (provider === "binance") {
      candles = await getBinanceCandles(symbol, timeframe, limit);
    } else {
      return res.status(400).json({
        error: "Unknown provider. Use twelvedata, alphavantage or binance.",
      });
    }

    if (!candles.length) {
      return res.status(502).json({
        error: "The provider returned no valid candles.",
      });
    }

    res.json({
      provider,
      symbol,
      timeframe,
      count: candles.length,
      candles,
    });
  } catch (error) {
    console.error("Candle request failed:", error.message);

    res.status(502).json({
      error: error.message || "Unable to load candles.",
    });
  }
});

// ------------------------------ Free News data sources ------------------------------

const newsCache = new Map();

async function getCachedNews(key, ttlMs, loader) {
  const cached = newsCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loader();

  newsCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  return value;
}

// ------------------------------ Economic calendar ------------------------------

app.get("/api/news/calendar", async (req, res) => {
  try {
    const allowedCurrencies = new Set([
      "USD", "EUR", "GBP", "JPY", "AUD",
      "NZD", "CAD", "CHF", "CNY",
    ]);

    const allowedImpacts = new Set([
      "high", "medium", "low", "holiday",
    ]);

    const currencies = String(req.query.currency || "USD,EUR,GBP,CAD")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => allowedCurrencies.has(value));

    const impacts = String(req.query.impact || "high,medium")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedImpacts.has(value));

    const parsedDays = Number.parseInt(req.query.days || "7", 10);
    const days = Math.min(
      30,
      Math.max(1, Number.isFinite(parsedDays) ? parsedDays : 7)
    );

    if (!currencies.length || !impacts.length) {
      return res.status(400).json({
        error: "Choose supported currencies and impact levels.",
      });
    }

    const key =
      `calendar:${currencies.slice().sort().join(",")}:` +
      `${impacts.slice().sort().join(",")}:${days}`;

    const data = await getCachedNews(key, 15 * 60 * 1000, async () => {
      const url = new URL(
        "https://showmytrades.com/api/public/calendar/v1"
      );

      url.searchParams.set("currency", currencies.join(","));
      url.searchParams.set("impact", impacts.join(","));
      url.searchParams.set("days", String(days));

      return fetchJson(url.toString(), {
        signal: AbortSignal.timeout(12000),
      });
    });

    res.set("Cache-Control", "public, max-age=60");
    res.json({ ...data, provider: "ShowMyTrades" });
  } catch (error) {
    console.error("Economic calendar request failed:", error.message);

    res.status(502).json({
      error: error.message || "Unable to retrieve the economic calendar.",
    });
  }
});

// ------------------------------ Crypto news search ------------------------------

app.get("/api/news/crypto", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 100);
    const cacheKey = `crypto:${query.toLowerCase() || "latest"}`;

    const data = await getCachedNews(cacheKey, 2 * 60 * 1000, async () => {
      const url = new URL(
        query
          ? "https://cryptocurrency.cv/api/search"
          : "https://cryptocurrency.cv/api/news"
      );

      if (query) {
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "20");
      } else {
        url.searchParams.set("limit", "3");
      }

      return fetchJson(url.toString(), {
        signal: AbortSignal.timeout(15000),
      });
    });

    const articles = Array.isArray(data.articles) ? data.articles : [];

    const sortedArticles = [...articles].sort((a, b) => {
      const dateA = Date.parse(
        a.pubDate || a.publishedAt || a.published_at || ""
      );
      const dateB = Date.parse(
        b.pubDate || b.publishedAt || b.published_at || ""
      );

      return (
        (Number.isFinite(dateB) ? dateB : 0) -
        (Number.isFinite(dateA) ? dateA : 0)
      );
    });

    res.set("Cache-Control", "public, max-age=60");

    res.json({
      ...data,
      articles: sortedArticles,
      query,
      provider: "Free Crypto News",
    });
  } catch (error) {
    console.error("Crypto news request failed:", error.message);

    res.status(502).json({
      error: error.message || "Unable to retrieve crypto news.",
      articles: [],
    });
  }
});

// ------------------------------ Unknown API routes ------------------------------

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.listen(PORT, () => {
  console.log(`NOX TRADE backend running at http://localhost:${PORT}`);
});
