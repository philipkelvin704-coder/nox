import express from "express";

import cors from "cors";

import dotenv from "dotenv";



dotenv.config();



const app = express();

const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));

app.use(express.json());



const TIMEFRAMES = {

  "1m": { twelve: "1min", alpha: "1min", binance: "1m", bybit: "1" },

  "3m": { twelve: null, alpha: null, binance: "3m", bybit: "3" },

  "5m": { twelve: "5min", alpha: "5min", binance: "5m", bybit: "5" },

  "15m": { twelve: "15min", alpha: "15min", binance: "15m", bybit: "15" },

  "30m": { twelve: "30min", alpha: "30min", binance: "30m", bybit: "30" },

  "1h": { twelve: "1h", alpha: "60min", binance: "1h", bybit: "60" },

  "2h": { twelve: "2h", alpha: null, binance: "2h", bybit: "120" },

  "4h": { twelve: "4h", alpha: null, binance: "4h", bybit: "240" },

  "1D": { twelve: "1day", alpha: "daily", binance: "1d", bybit: "D" },

  "1W": { twelve: "1week", alpha: "weekly", binance: "1w", bybit: "W" },

  "1M": { twelve: "1month", alpha: "monthly", binance: "1M", bybit: "M" },

};





app.get("/api/status", (_req, res) => {

  res.json({

    app: "NOX TRADE",

    backend: "online",

    providers: {

      twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),

      alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY),

      binance: "public market data",

      cryptoMarkets: "Binance USDT-M perpetual futures market data",

      deriv: "handled separately by deriv.js",

    },

  });

});



function normalizeTimeframe(value) {

  const input = String(value || "15m").trim();

  if (Object.prototype.hasOwnProperty.call(TIMEFRAMES, input)) return input;

  const match = Object.keys(TIMEFRAMES).find((key) => key.toLowerCase() === input.toLowerCase());

  if (!match) throw new Error("Unsupported timeframe. Use 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, 1W or 1M.");

  return match;

}



function normalizeSymbol(value) {

  const symbol = String(value || "").trim();

  if (!symbol || symbol.length > 80 || !/^[A-Za-z0-9/\_-]+$/.test(symbol)) throw new Error("Invalid market symbol.");

  return symbol;

}



async function fetchJson(url, options = {}) {

  const headers = { Accept: "application/json", ...(options.headers || {}) };

  const response = await fetch(url, { ...options, headers });

  const raw = await response.text();

  let data;

  try {

    data = JSON.parse(raw);

  } catch {

    throw new Error(\`Provider returned invalid JSON (HTTP ${response.status}): ${raw\.slice(0, 160).replace(/**\\\\**&#x73;+/g, " ")}\`);

  }

  if (!response.ok) {

    const message = data?.error?.message || data?.status?.error_message || data?.message || data?.msg || JSON.stringify(data).slice(0, 250);

    throw new Error(\`Provider request failed (${response.status}): ${message}\`);

  }

  return data;

}



// ------------------------------ Twelve Data ------------------------------

function normalizeTwelveData(data) {

  if (!Array.isArray(data.values)) throw new Error(data.message || data["Error Message"] || "Twelve Data returned no candles.");

  return data.values.map((c) => ({

    time: new Date(c.datetime.replace(" ", "T") + "Z").toISOString(),

    open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),

  })).filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite)).reverse();

}



async function getTwelveDataCandles(symbol, timeframe, limit) {

  const interval = TIMEFRAMES[timeframe].twelve;

  if (!interval) throw new Error(\`Twelve Data does not have a configured native interval for ${timeframe}.\`);

  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing from .env.");

  const url = new URL("https\://api.twelvedata.com/time_series");

  url.searchParams.set("symbol", symbol.replace("-", "/"));

  url.searchParams.set("interval", interval);

  url.searchParams.set("outputsize", String(limit));

  url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

  return normalizeTwelveData(await fetchJson(url)).slice(-limit);

}



// ------------------------------ Alpha Vantage ------------------------------

function normalizeAlphaVantage(data) {

  const seriesKey = Object.keys(data).find((key) => key.startsWith("Time Series FX"));

  if (!seriesKey) throw new Error(data.Note || data.Information || data["Error Message"] || "Alpha Vantage returned no candle series. Check the symbol, interval and API limits.");

  return Object.entries(data[seriesKey]).map(([time, c]) => ({

    time: time.includes(" ") ? time.replace(" ", "T") + "Z" : time + "T00:00:00Z",

    open: Number(c["1. open"]), high: Number(c["2. high"]), low: Number(c["3. low"]), close: Number(c["4. close"]),

  })).filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

}



async function getAlphaVantageCandles(symbol, timeframe, limit) {

  const interval = TIMEFRAMES[timeframe].alpha;

  if (!interval) throw new Error(\`Alpha Vantage's configured FX intervals do not support ${timeframe}.\`);

  if (!process.env.ALPHA_VANTAGE_API_KEY) throw new Error("ALPHA_VANTAGE_API_KEY is missing from .env.");

  const pair = symbol.replace(/[^A-Za-z]/g, "").toUpperCase();

  if (!/^[A-Z]{6}$/.test(pair)) throw new Error("Alpha Vantage FX candles require a six-letter pair such as EURUSD.");

  const url = new URL("https\://www\.alphavantage.co/query");

  url.searchParams.set("from_symbol", pair.slice(0, 3));

  url.searchParams.set("to_symbol", pair.slice(3, 6));

  url.searchParams.set("apikey", process.env.ALPHA_VANTAGE_API_KEY);

  if (["daily", "weekly", "monthly"].includes(interval)) url.searchParams.set("function", \`FX\_${interval.toUpperCase()}\`);

  else {

    url.searchParams.set("function", "FX_INTRADAY");

    url.searchParams.set("interval", interval);

    url.searchParams.set("outputsize", limit > 100 ? "full" : "compact");

  }

  return normalizeAlphaVantage(await fetchJson(url)).slice(-limit);

}



// ------------------------------ Binance ------------------------------

function normalizeBinance(rows) {

  if (!Array.isArray(rows)) throw new Error("Binance returned an unexpected candle response.");

  return rows.map((c) => ({

    time: new Date(Number(c[0])).toISOString(),

    open: Number(c[1]),

    high: Number(c[2]),

    low: Number(c[3]),

    close: Number(c[4]),

    volume: Number(c[5]),

    closeTime: new Date(Number(c[6])).toISOString(),

    quoteVolume: Number(c[7]),

    tradeCount: Number(c[8]),

    takerBuyBaseVolume: Number(c[9]),

    takerBuyQuoteVolume: Number(c[10]),

  }));

}



async function getBinanceCandles(symbol, timeframe, limit) {

  const url = new URL("https://fapi.binance.com/fapi/v1/klines");

  url.searchParams.set("symbol", symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase());

  url.searchParams.set("interval", TIMEFRAMES[timeframe].binance);

  url.searchParams.set("limit", String(Math.min(limit, 1000)));

  const data = await fetchJson(url);

  if (!Array.isArray(data)) throw new Error(data.msg || "Binance USDT-M Futures could not return these candles.");

  return normalizeBinance(data);

}



// ------------------------------ Bybit backup (USDT linear perpetuals) ------------------------------

const BYBIT_MARKETS_CACHE_MS = 5 * 60 * 1000;
let bybitMarketsCache = null;
let bybitMarketsCacheAt = 0;
let bybitMarketsRefresh = null;

async function getBybitMarkets() {
  if (bybitMarketsCache && Date.now() - bybitMarketsCacheAt < BYBIT_MARKETS_CACHE_MS) {
    return bybitMarketsCache;
  }
  if (!bybitMarketsRefresh) {
    bybitMarketsRefresh = (async () => {
      const [instrumentsData, tickersData] = await Promise.all([
        fetchJson("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000"),
        fetchJson("https://api.bybit.com/v5/market/tickers?category=linear"),
      ]);
      if (instrumentsData.retCode !== 0 || !Array.isArray(instrumentsData.result?.list)) {
        throw new Error(instrumentsData.retMsg || "Bybit instruments request failed.");
      }
      if (tickersData.retCode !== 0 || !Array.isArray(tickersData.result?.list)) {
        throw new Error(tickersData.retMsg || "Bybit ticker request failed.");
      }

      const instruments = [...instrumentsData.result.list];
      let cursor = instrumentsData.result.nextPageCursor;
      let pages = 0;
      while (cursor && pages < 5) {
        const pageUrl = new URL("https://api.bybit.com/v5/market/instruments-info");
        pageUrl.searchParams.set("category", "linear");
        pageUrl.searchParams.set("limit", "1000");
        pageUrl.searchParams.set("cursor", cursor);
        const page = await fetchJson(pageUrl);
        if (page.retCode !== 0 || !Array.isArray(page.result?.list)) {
          throw new Error(page.retMsg || "Bybit instruments pagination failed.");
        }
        instruments.push(...page.result.list);
        cursor = page.result.nextPageCursor;
        pages += 1;
      }

      const tickers = new Map(tickersData.result.list.map((item) => [item.symbol, item]));
      const markets = instruments
        .filter((item) =>
          item.status === "Trading" &&
          item.contractType === "LinearPerpetual" &&
          item.quoteCoin === "USDT" &&
          item.settleCoin === "USDT"
        )
        .map((item) => {
          const ticker = tickers.get(item.symbol);
          if (!ticker) return null;
          return {
            id: item.baseCoin,
            name: item.baseCoin,
            symbol: item.baseCoin,
            baseAsset: item.baseCoin,
            exchangeSymbol: item.symbol,
            currentPrice: Number(ticker.lastPrice),
            quoteVolume: Number(ticker.turnover24h || 0),
            marketCapRank: null,
          };
        })
        .filter((item) => item && Number.isFinite(item.currentPrice) && Number.isFinite(item.quoteVolume))
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, 100);

      bybitMarketsCache = {
        provider: "bybit-linear",
        marketType: "USDT LINEAR PERPETUAL",
        count: markets.length,
        markets,
      };
      bybitMarketsCacheAt = Date.now();
      return bybitMarketsCache;
    })().finally(() => { bybitMarketsRefresh = null; });
  }
  return bybitMarketsRefresh;
}

async function getBybitCandles(symbol, timeframe, limit) {
  const url = new URL("https://api.bybit.com/v5/market/kline");
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
  url.searchParams.set("interval", TIMEFRAMES[timeframe].bybit);
  url.searchParams.set("limit", String(Math.min(limit, 1000)));
  const data = await fetchJson(url);
  if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
    throw new Error(data.retMsg || "Bybit Futures candles could not be retrieved.");
  }
  return data.result.list.map((c) => ({
    time: new Date(Number(c[0])).toISOString(),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
    quoteVolume: Number(c[6]),
  })).filter((c) => [c.open,c.high,c.low,c.close].every(Number.isFinite))
    .sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
}

// ------------------------------ Binance markets ------------------------------

// Binance's all-symbol 24-hour ticker request is relatively expensive.
// Cache the market list and deduplicate simultaneous refreshes across requests.
const BINANCE_MARKETS_CACHE_MS = 15 * 60 * 1000;
let binanceMarketsCache = null;
let binanceMarketsCacheAt = 0;
let binanceMarketsRefresh = null;
let binanceMarketsBlockedUntil = 0;

async function refreshBinanceMarkets() {
  const [exchangeInfo, tickerData] = await Promise.all([
    fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo"),
    fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr"),
  ]);

  if (!Array.isArray(exchangeInfo.symbols) || !Array.isArray(tickerData)) {
    throw new Error("Binance returned an unexpected market-list format.");
  }

  const prices = new Map(tickerData.map((ticker) => [ticker.symbol, ticker]));
  const markets = exchangeInfo.symbols
    .filter((item) =>
      item.status === "TRADING" &&
      item.quoteAsset === "USDT" &&
      item.contractType === "PERPETUAL"
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
    .filter((item) =>
      item &&
      Number.isFinite(item.currentPrice) &&
      Number.isFinite(item.quoteVolume)
    )
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, 100);

  const payload = {
    provider: "binance-usdm-futures",
    marketType: "USDT-M PERPETUAL",
    count: markets.length,
    markets,
  };

  binanceMarketsCache = payload;
  binanceMarketsCacheAt = Date.now();
  return payload;
}

app.get("/api/binance/markets", async (_req, res) => {
  const cacheIsFresh =
    binanceMarketsCache &&
    Date.now() - binanceMarketsCacheAt < BINANCE_MARKETS_CACHE_MS;

  if (cacheIsFresh) {
    return res.set("Cache-Control", "public, max-age=300").json(binanceMarketsCache);
  }

  // Avoid repeatedly calling Binance while its temporary IP ban is active.
  if (Date.now() < binanceMarketsBlockedUntil) {
    if (binanceMarketsCache) {
      return res.set("X-NOX-Stale-Cache", "true").json(binanceMarketsCache);
    }
    try {
      const backup = await getBybitMarkets();
      return res.set("X-NOX-Backup-Provider", "bybit-linear").json(backup);
    } catch (backupError) {
      return res.status(503).json({
        error: `Binance is in cooldown and Bybit backup failed: ${backupError.message}`,
        markets: [],
        retryAt: new Date(binanceMarketsBlockedUntil).toISOString(),
      });
    }
  }

  try {
    if (!binanceMarketsRefresh) {
      binanceMarketsRefresh = refreshBinanceMarkets()
        .catch((error) => {
          const message = String(error?.message || "");
          const banMatch = message.match(/banned until\s+(\d{10,})/i);
          if (banMatch) {
            const timestamp = Number(banMatch[1]);
            binanceMarketsBlockedUntil = timestamp > 1e12 ? timestamp : timestamp * 1000;
          } else if (/HTTP 418|HTTP 429/i.test(message)) {
            binanceMarketsBlockedUntil = Date.now() + 15 * 60 * 1000;
          }
          throw error;
        })
        .finally(() => {
          binanceMarketsRefresh = null;
        });
    }

    const payload = await binanceMarketsRefresh;
    return res.set("Cache-Control", "public, max-age=300").json(payload);
  } catch (error) {
    console.error("Binance market-list request failed:", error.message);
    if (binanceMarketsCache) {
      return res.set("X-NOX-Stale-Cache", "true").json(binanceMarketsCache);
    }
    try {
      const backup = await getBybitMarkets();
      return res.set("X-NOX-Backup-Provider", "bybit-linear").json(backup);
    } catch (backupError) {
      return res.status(502).json({
        error: `${error.message || "Binance market list failed."} Bybit backup failed: ${backupError.message}`,
        markets: [],
      });
    }
  }
});



// ------------------------------ Shared candle endpoint ------------------------------

app.get("/api/candles", async (req, res) => {

  try {

    const provider = String(req.query.provider || "").toLowerCase();

    const symbol = normalizeSymbol(req.query.symbol);

    const timeframe = normalizeTimeframe(req.query.timeframe || "15m");

    const parsedLimit = Number.parseInt(req.query.limit || "100", 10);

    const limit = Math.min(500, Math.max(20, Number.isFinite(parsedLimit) ? parsedLimit : 100));

    let candles;

    if (provider === "twelvedata") candles = await getTwelveDataCandles(symbol, timeframe, limit);

    else if (provider === "alphavantage") candles = await getAlphaVantageCandles(symbol, timeframe, limit);

    else if (provider === "binance") candles = await getBinanceCandles(symbol, timeframe, limit);
    else if (provider === "bybit") candles = await getBybitCandles(symbol, timeframe, limit);

    else return res.status(400).json({ error: "Unknown provider. Use twelvedata, alphavantage, binance or bybit." });

    if (!candles.length) return res.status(502).json({ error: "The provider returned no valid candles." });

    res.json({ provider, symbol, timeframe, count: candles.length, candles });

  } catch (error) {

    console.error("Candle request failed:", error.message);

    res.status(502).json({ error: error.message || "Unable to load candles." });

  }

});







// Always return JSON for unknown API routes; this helps the frontend explain routing mistakes.

app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));



app.listen(PORT, () => console.log(\`NOX TRADE backend running at http\://localhost:${PORT}\`));
