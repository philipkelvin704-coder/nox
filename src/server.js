
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

const COINGECKO_API = "https://api.coingecko.com/api/v3";

// --------------------------------------------------
// Provider response cache
// --------------------------------------------------

const providerCache = new Map();
const providerRequestsInFlight = new Map();

async function fetchJsonCached(
  url,
  options = {},
  cacheDurationMs = 10 * 60 * 1000,
  staleDurationMs = 24 * 60 * 60 * 1000
) {
  const cacheKey = url.toString();
  const now = Date.now();
  const cached = providerCache.get(cacheKey);

  // Return fresh cached data without contacting the provider.
  if (cached && now - cached.savedAt < cacheDurationMs) {
    return cached.data;
  }

  // Reuse an identical request already in progress.
  if (providerRequestsInFlight.has(cacheKey)) {
    return providerRequestsInFlight.get(cacheKey);
  }

  const request = (async () => {
    try {
      const data = await fetchJson(url, options);

      providerCache.set(cacheKey, {
        data,
        savedAt: Date.now(),
      });

      return data;
    } catch (error) {
      // Use older cached data if the provider is temporarily unavailable.
      const latestCache = providerCache.get(cacheKey);

      if (
        latestCache &&
        Date.now() - latestCache.savedAt <=
          cacheDurationMs + staleDurationMs
      ) {
        console.warn(
          "Using cached provider data after request failure:",
          error.message
        );

        return latestCache.data;
      }

      throw error;
    } finally {
      providerRequestsInFlight.delete(cacheKey);
    }
  })();

  providerRequestsInFlight.set(cacheKey, request);

  return request;
}

// --------------------------------------------------
// Status
// --------------------------------------------------

app.get("/api/status", (_req, res) => {
  res.json({
    app: "NOX TRADE",
    backend: "online",
    providers: {
      twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
      alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      binance: "public market data",
      coinGecko: "crypto market data",
      deriv: "handled separately by deriv.js",
    },
  });
});

// --------------------------------------------------
// Validation helpers
// --------------------------------------------------

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

  if (
    !symbol ||
    symbol.length > 80 ||
    !/^[A-Za-z0-9/_-]+$/.test(symbol)
  ) {
    throw new Error("Invalid market symbol.");
  }

  return symbol;
}

// --------------------------------------------------
// Shared HTTP helper
// --------------------------------------------------

async function fetchJson(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

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

    throw new Error(
      `Provider request failed (${response.status}): ${message}`
    );
  }

  return data;
}

function coinGeckoHeaders() {
  const headers = {};

  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }

  return headers;
}

// --------------------------------------------------
// Twelve Data
// --------------------------------------------------

function normalizeTwelveData(data) {
  if (!Array.isArray(data.values)) {
    throw new Error(
      data.message ||
        data["Error Message"] ||
        "Twelve Data returned no candles."
    );
  }

  return data.values
    .map((c) => ({
      time: new Date(
        c.datetime.replace(" ", "T") + "Z"
      ).toISOString(),
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

// --------------------------------------------------
// Alpha Vantage
// --------------------------------------------------

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
    url.searchParams.set(
      "function",
      `FX_${interval.toUpperCase()}`
    );
  } else {
    url.searchParams.set("function", "FX_INTRADAY");
    url.searchParams.set("interval", interval);
    url.searchParams.set(
      "outputsize",
      limit > 100 ? "full" : "compact"
    );
  }

  return normalizeAlphaVantage(await fetchJson(url)).slice(-limit);
}

// --------------------------------------------------
// Binance
// --------------------------------------------------

function normalizeBinance(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Binance returned an unexpected candle response.");
  }

  return rows.map((c) => ({
    time: new Date(Number(c[0])).toISOString(),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
  }));
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

// --------------------------------------------------
// CoinGecko market list
// --------------------------------------------------

app.get("/api/coingecko/markets", async (_req, res) => {
  try {
    const url = new URL(`${COINGECKO_API}/coins/markets`);

    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("order", "market_cap_desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", "1");
    url.searchParams.set("sparkline", "false");

    // Cache for 10 minutes; allow older cached data for up to 24 hours.
    const data = await fetchJsonCached(
      url,
      { headers: coinGeckoHeaders() },
      10 * 60 * 1000,
      24 * 60 * 60 * 1000
    );

    if (!Array.isArray(data)) {
      throw new Error(
        "CoinGecko returned an unexpected market-list format."
      );
    }

    const markets = data
      .filter((coin) => coin?.id && coin?.name && coin?.symbol)
      .map((coin) => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        currentPrice: coin.current_price ?? null,
        marketCapRank: coin.market_cap_rank ?? null,
      }));

    res.json({
      provider: "coingecko",
      count: markets.length,
      markets,
    });
  } catch (error) {
    console.error(
      "CoinGecko market-list request failed:",
      error.message
    );

    res.status(502).json({
      error:
        error.message ||
        "Unable to retrieve the CoinGecko crypto market list.",
      markets: [],
    });
  }
});

// --------------------------------------------------
// CoinGecko OHLC candles
// --------------------------------------------------

function normalizeCoinGeckoOHLC(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("CoinGecko returned an unexpected OHLC response.");
  }

  return rows
    .map((row) => {
      if (!Array.isArray(row) || row.length < 5) {
        return null;
      }

      const timestamp = Number(row[0]);

      return {
        time: new Date(timestamp).toISOString(),
        epoch: Math.floor(timestamp / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
      };
    })
    .filter(
      (c) =>
        c &&
        Number.isFinite(Date.parse(c.time)) &&
        [c.open, c.high, c.low, c.close].every(Number.isFinite)
    )
    .sort((a, b) => a.epoch - b.epoch);
}

function getCandleBucketStart(epochSeconds, timeframe) {
  const date = new Date(epochSeconds * 1000);

  if (timeframe === "1W") {
    const start = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );

    start.setUTCDate(
      start.getUTCDate() - ((start.getUTCDay() + 6) % 7)
    );

    return Math.floor(start.getTime() / 1000);
  }

  if (timeframe === "1M") {
    return Math.floor(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000
    );
  }

  if (timeframe === "1D") {
    return Math.floor(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      ) / 1000
    );
  }

  const seconds = {
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
  }[timeframe];

  if (!seconds) {
    throw new Error(
      `CoinGecko candle aggregation is not supported for ${timeframe}.`
    );
  }

  return Math.floor(epochSeconds / seconds) * seconds;
}

function aggregateCoinGeckoCandles(candles, timeframe) {
  const groups = new Map();

  for (const candle of candles) {
    const bucket = getCandleBucketStart(candle.epoch, timeframe);
    const time = new Date(bucket * 1000).toISOString();
    const current = groups.get(bucket);

    if (!current) {
      groups.set(bucket, {
        time,
        epoch: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    }
  }

  return [...groups.values()].sort((a, b) => a.epoch - b.epoch);
}

async function getCoinGeckoCandles(coinId, timeframe, limit) {
  if (!/^[A-Za-z0-9-]+$/.test(coinId)) {
    throw new Error("Invalid CoinGecko coin ID.");
  }

  if (["1m", "3m", "5m", "15m"].includes(timeframe)) {
    throw new Error(
      "CoinGecko's OHLC endpoint does not provide dependable candles at this small timeframe. Select 30m or higher for crypto."
    );
  }

  let days;

  if (["30m", "1h", "2h", "4h"].includes(timeframe)) {
    days = "1";
  } else if (timeframe === "1D") {
    days = "30";
  } else if (timeframe === "1W") {
    days = "90";
  } else if (timeframe === "1M") {
    days = "365";
  } else {
    throw new Error(
      `CoinGecko candles are not configured for ${timeframe}.`
    );
  }

  const url = new URL(
    `${COINGECKO_API}/coins/${encodeURIComponent(coinId)}/ohlc`
  );

  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("days", days);

  // Cache candles for 5 minutes; allow older cached data for up to 24 hours.
  const raw = await fetchJsonCached(
    url,
    { headers: coinGeckoHeaders() },
    5 * 60 * 1000,
    24 * 60 * 60 * 1000
  );

  let candles = normalizeCoinGeckoOHLC(raw);

  if (!candles.length) {
    throw new Error(
      "CoinGecko returned no valid OHLC candles for this coin."
    );
  }

  if (timeframe !== "30m") {
    candles = aggregateCoinGeckoCandles(candles, timeframe);
  }

  candles = candles.slice(-limit);

  if (candles.length < 5) {
    throw new Error(
      `CoinGecko returned only ${candles.length} candles for ${timeframe}. Try a different timeframe or market.`
    );
  }

  return candles;
}

// --------------------------------------------------
// Shared candle endpoint
// --------------------------------------------------

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
    } else if (provider === "coingecko") {
      candles = await getCoinGeckoCandles(symbol, timeframe, limit);
    } else {
      return res.status(400).json({
        error:
          "Unknown provider. Use twelvedata, alphavantage, binance or coingecko.",
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

// --------------------------------------------------
// Unknown API routes
// --------------------------------------------------

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`NOX TRADE backend running at http://localhost:${PORT}`);
});
