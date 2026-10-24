
const DEFAULT_APP_ID = import.meta.env.VITE_DERIV_APP_ID || "1089";

const ENDPOINTS = [
  "wss://api.derivws.com/trading/v1/options/ws/public",
  `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(DEFAULT_APP_ID)}`,
  `wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(DEFAULT_APP_ID)}`,
  "wss://ws.binaryws.com/websockets/v3",
];

const CONNECT_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;

class DerivClient {
  constructor(socket, endpoint) {
    this.socket = socket;
    this.endpoint = endpoint;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.closed = false;

    // Attach immediately so responses are not missed.
    socket.addEventListener("message", (event) => {
      this.handleMessage(event);
    });

    socket.addEventListener("close", (event) => {
      this.closed = true;

      const detail = event.reason
        ? `WebSocket closed (${event.code}): ${event.reason}`
        : `WebSocket closed with code ${event.code}.`;

      for (const [id, request] of this.pending) {
        clearTimeout(request.timeout);
        request.reject(new Error(detail));
        this.pending.delete(id);
      }
    });

    socket.addEventListener("error", () => {
      console.error(
        `[Deriv] WebSocket error using endpoint: ${this.endpoint}`
      );
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

    const requestId = data.req_id;
    if (requestId == null) return;

    const pendingRequest = this.pending.get(requestId);
    if (!pendingRequest) return;

    clearTimeout(pendingRequest.timeout);
    this.pending.delete(requestId);

    if (data.error) {
      pendingRequest.reject(
        new Error(data.error.message || "Deriv API request failed.")
      );
      return;
    }

    pendingRequest.resolve(data);
  }

  request(payload) {
    if (
      this.closed ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return Promise.reject(
        new Error("The Deriv WebSocket is not connected.")
      );
    }

    const req_id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(req_id);
        reject(
          new Error(
            `Deriv request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          )
        );
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
    const response = await this.request({
      active_symbols: "full",
    });

    const symbols = response.active_symbols;

    if (!Array.isArray(symbols)) {
      throw new Error("Deriv connected, but returned no active-symbol list.");
    }

    // Support both newer and legacy response field names.
    return symbols.map((item) => ({
      ...item,
      underlying_symbol:
        item.underlying_symbol || item.symbol || "",
      underlying_symbol_name:
        item.underlying_symbol_name ||
        item.display_name ||
        item.underlying_symbol ||
        item.symbol ||
        "Unknown market",
      market: item.market || item.market_display_name || "",
      submarket: item.submarket || item.submarket_display_name || "",
    })).filter((item) => item.underlying_symbol);
  }

  async getCandles(symbol, granularity, count = 100) {
    const marketSymbol =
      typeof symbol === "string"
        ? symbol
        : symbol?.underlying_symbol || symbol?.symbol;

    if (!marketSymbol) {
      throw new Error("No valid market symbol was supplied.");
    }

    const response = await this.request({
      ticks_history: marketSymbol,
      count,
      end: "latest",
      style: "candles",
      granularity: Number(granularity),
    });

    const candles = response.candles || response.history?.candles;

    if (!Array.isArray(candles)) {
      throw new Error(
        `Deriv returned no candle history for ${marketSymbol}.`
      );
    }

    return candles.map((candle) => ({
      epoch: Number(candle.epoch),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    }));
  }

  close() {
    this.closed = true;

    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(new Error("Deriv connection was closed."));
      this.pending.delete(id);
    }

    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
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

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        socket.close();
      } catch {
        // Ignore cleanup errors.
      }

      reject(new Error("Connection attempt timed out."));
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);

      console.info(`[Deriv] WebSocket connected: ${url}`);
      resolve(new DerivClient(socket, url));
    }, { once: true });

    socket.addEventListener("error", () => {
      // Wait for close or timeout to capture the most useful detail.
    }, { once: true });

    socket.addEventListener("close", (event) => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);

      reject(
        new Error(
          `Connection closed before opening (code ${event.code || "unknown"}${event.reason ? `: ${event.reason}` : ""}).`
        )
      );
    }, { once: true });
  });
}

export async function connectToDeriv() {
  const failures = [];

  for (const endpoint of ENDPOINTS) {
    try {
      console.info(`[Deriv] Trying endpoint: ${endpoint}`);

      const client = await openSocket(endpoint);

      // Verify the connection is actually responding to API requests.
      await client.request({ ping: 1 });

      console.info("[Deriv] Connection and ping test succeeded.");
      return client;
    } catch (error) {
      const message = error?.message || "Unknown connection error.";
      failures.push(`${endpoint}: ${message}`);

      console.warn(`[Deriv] Endpoint failed: ${message}`);
    }
  }

  throw new Error(
    "Could not connect to Deriv using the available public endpoints. " +
    "Check your network/firewall and registered App ID. Details: " +
    failures.join(" | ")
  );
}

// Compatibility helpers for any existing imports that use these names.
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
