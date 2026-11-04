const DEFAULT_APP_ID = import.meta.env.VITE_DERIV_APP_ID || "1089";

// The current public market-data endpoint needs no App ID. Legacy v3 endpoints
// remain as compatibility fallbacks for networks where the current endpoint is blocked.
const ENDPOINTS = [
  "wss://api.derivws.com/trading/v1/options/ws/public",
  `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(DEFAULT_APP_ID)}`,
  `wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(DEFAULT_APP_ID)}`,
];

const CONNECT_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;

function toFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function aggregateCandles(candles, period) {
  const buckets = new Map();
  for (const candle of candles) {
    const date = new Date(candle.epoch * 1000);
    let start;
    if (period === "1W") {
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      date.setUTCHours(0, 0, 0, 0);
      start = Math.floor(date.getTime() / 1000);
    } else {
      date.setUTCDate(1);
      date.setUTCHours(0, 0, 0, 0);
      start = Math.floor(date.getTime() / 1000);
    }

    const existing = buckets.get(start);
    if (!existing) {
      buckets.set(start, { epoch: start, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.epoch - b.epoch);
}

class DerivClient {
  constructor(socket, endpoint) {
    this.socket = socket;
    this.endpoint = endpoint;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.closed = false;

    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", (event) => {
      this.closed = true;
      const detail = event.reason
        ? `Deriv WebSocket closed (${event.code}): ${event.reason}`
        : `Deriv WebSocket closed with code ${event.code}.`;
      for (const [id, request] of this.pending) {
        clearTimeout(request.timeout);
        request.reject(new Error(detail));
        this.pending.delete(id);
      }
    });
    socket.addEventListener("error", () => {
      console.error(`[Deriv] WebSocket error using ${this.endpoint}`);
    });
  }

  handleMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      console.warn("[Deriv] Received a non-JSON message.");
      return;
    }

    const requestId = data.req_id ?? data.echo_req?.req_id;
    if (requestId == null) return;
    const pendingRequest = this.pending.get(requestId);
    if (!pendingRequest) return;

    clearTimeout(pendingRequest.timeout);
    this.pending.delete(requestId);
    if (data.error) {
      pendingRequest.reject(new Error(data.error.message || "Deriv API request failed."));
      return;
    }
    pendingRequest.resolve(data);
  }

  request(payload) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The Deriv WebSocket is not connected."));
    }

    const req_id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(req_id);
        reject(new Error(`Deriv request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(req_id, { resolve, reject, timeout });
      try {
        this.socket.send(JSON.stringify({ ...payload, req_id }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(req_id);
        reject(error);
      }
    });
  }

  async getActiveSymbols() {
    const response = await this.request({ active_symbols: "full" });
    const symbols = response.active_symbols || response.data?.active_symbols;
    if (!Array.isArray(symbols)) {
      throw new Error(response.error?.message || "Deriv connected but did not return an active-symbol list.");
    }

    return symbols.map((item) => ({
      ...item,
      underlying_symbol: item.underlying_symbol || item.symbol || item.symbol_code || "",
      underlying_symbol_name: item.underlying_symbol_name || item.display_name || item.name || item.underlying_symbol || item.symbol || "",
      market: item.market_display_name || item.market_name || item.market || "",
      submarket: item.submarket_display_name || item.submarket_name || item.submarket || "",
    })).filter((item) => String(item.underlying_symbol).trim());
  }

  async getRawCandles(symbol, granularity, count) {
    const response = await this.request({
      ticks_history: symbol,
      count,
      end: "latest",
      style: "candles",
      granularity,
    });
    const rows = response.candles || response.history?.candles || response.data?.candles;
    if (!Array.isArray(rows)) {
      throw new Error(response.error?.message || `Deriv returned no candle history for ${symbol}.`);
    }
    return rows.map((candle) => ({
      epoch: toFinite(candle.epoch),
      open: toFinite(candle.open),
      high: toFinite(candle.high),
      low: toFinite(candle.low),
      close: toFinite(candle.close),
    })).filter((candle) => Number.isFinite(candle.epoch) &&
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
      .sort((a, b) => a.epoch - b.epoch);
  }

  async getCandles(symbol, granularity, count = 100) {
    const marketSymbol = typeof symbol === "string"
      ? symbol
      : symbol?.underlying_symbol || symbol?.symbol;
    if (!marketSymbol) throw new Error("No valid Deriv market symbol was supplied.");

    const requestedGranularity = Number(granularity);
    if (!Number.isFinite(requestedGranularity) || requestedGranularity < 60) {
      throw new Error("Unsupported Deriv candle timeframe.");
    }

    const safeCount = Math.min(5000, Math.max(20, Math.trunc(Number(count) || 100)));
    if (requestedGranularity <= 86400) {
      return this.getRawCandles(marketSymbol, requestedGranularity, safeCount);
    }

    // Deriv's native candle granularity tops out at one day. Build weekly and
    // monthly bars from daily candles so those existing UI timeframes remain usable.
    const period = requestedGranularity === 604800 ? "1W" : "1M";
    const dailyCount = Math.min(5000, safeCount * (period === "1W" ? 7 : 31));
    const dailyCandles = await this.getRawCandles(marketSymbol, 86400, dailyCount);
    return aggregateCandles(dailyCandles, period).slice(-safeCount);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(new Error("Deriv connection was closed."));
      this.pending.delete(id);
    }
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* cleanup only */ }
      reject(new Error("Connection attempt timed out."));
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.info(`[Deriv] Connected: ${url}`);
      resolve(new DerivClient(socket, url));
    }, { once: true });

    socket.addEventListener("error", () => {
      // The close event or timeout provides the useful failure detail.
    }, { once: true });

    socket.addEventListener("close", (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Connection closed before opening (code ${event.code || "unknown"}${event.reason ? `: ${event.reason}` : ""}).`));
    }, { once: true });
  });
}

export async function connectToDeriv() {
  const failures = [];
  for (const endpoint of ENDPOINTS) {
    let client = null;
    try {
      console.info(`[Deriv] Trying endpoint: ${endpoint}`);
      client = await openSocket(endpoint);
      await client.request({ ping: 1 });
      console.info("[Deriv] Connection and ping test succeeded.");
      return client;
    } catch (error) {
      const message = error?.message || "Unknown connection error.";
      failures.push(`${endpoint}: ${message}`);
      client?.close();
      console.warn(`[Deriv] Endpoint failed: ${message}`);
    }
  }
  throw new Error("Could not connect to Deriv using the available public endpoints. Check your network and, if using a legacy endpoint, your registered App ID. Details: " + failures.join(" | "));
}

export async function getCandles(client, symbol, granularity, count = 100) {
  if (!client || typeof client.getCandles !== "function") {
    throw new Error("A connected Deriv client is required.");
  }
  return client.getCandles(symbol, granularity, count);
}

export function formatCandleTime(epoch) {
  const value = Number(epoch);
  if (!Number.isFinite(value)) return "Unknown time";
  return new Date(value * 1000).toLocaleString();
}
