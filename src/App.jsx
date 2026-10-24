
import { useEffect, useMemo, useRef, useState } from "react";
import { connectToDeriv, getCandles, formatCandleTime } from "./deriv";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const BASE_MARKETS = [
  { label: "Volatility 10 Index", category: "Synthetic Indices", symbol: "R_10", provider: "deriv" },
  { label: "Volatility 25 Index", category: "Synthetic Indices", symbol: "R_25", provider: "deriv" },
  { label: "Volatility 50 Index", category: "Synthetic Indices", symbol: "R_50", provider: "deriv" },
  { label: "Volatility 75 Index", category: "Synthetic Indices", symbol: "R_75", provider: "deriv" },
  { label: "Volatility 100 Index", category: "Synthetic Indices", symbol: "R_100", provider: "deriv" },
  { label: "Volatility 10 (1s) Index", category: "Synthetic Indices", symbol: "1HZ10V", provider: "deriv" },
  { label: "Volatility 25 (1s) Index", category: "Synthetic Indices", symbol: "1HZ25V", provider: "deriv" },
  { label: "Volatility 50 (1s) Index", category: "Synthetic Indices", symbol: "1HZ50V", provider: "deriv" },
  { label: "Volatility 75 (1s) Index", category: "Synthetic Indices", symbol: "1HZ75V", provider: "deriv" },
  { label: "Volatility 100 (1s) Index", category: "Synthetic Indices", symbol: "1HZ100V", provider: "deriv" },
  { label: "EUR/USD", category: "Forex", symbol: "frxEURUSD", provider: "deriv" },
  { label: "GBP/JPY", category: "Forex", symbol: "frxGBPJPY", provider: "deriv" },
  { label: "USD/CAD", category: "Forex", symbol: "frxUSDCAD", provider: "deriv" },
  { label: "XAU/USD (Gold)", category: "Metals", symbol: "frxXAUUSD", provider: "deriv" },
  { label: "BTC/USD", category: "Crypto · Deriv", symbol: "cryBTCUSD", provider: "deriv" },
];

const TIMEFRAMES = [
  { label: "1 minute", value: 60, apiValue: "1m" },
  { label: "3 minutes", value: 180, apiValue: "3m" },
  { label: "5 minutes", value: 300, apiValue: "5m" },
  { label: "15 minutes", value: 900, apiValue: "15m" },
  { label: "30 minutes", value: 1800, apiValue: "30m" },
  { label: "1 hour", value: 3600, apiValue: "1h" },
  { label: "2 hours", value: 7200, apiValue: "2h" },
  { label: "4 hours", value: 14400, apiValue: "4h" },
  { label: "1 day", value: 86400, apiValue: "1D" },
  { label: "1 week", value: 604800, apiValue: "1W" },
  { label: "1 month", value: 2592000, apiValue: "1M" },
];

const isCrypto = (market) => market?.provider === "coingecko";

const fmt = (value) =>
  Number.isFinite(Number(value))
    ? Number(value).toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 8,
      })
    : "—";

function formatAxisPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "—";

  return number.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: Math.abs(number) < 10 ? 5 : 3,
  });
}

async function copyPrice(value) {
  const text = fmt(value);

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

function CopyPrice({ value, size = "" }) {
  const displayValue = fmt(value);

  return (
    <span className={`copy-price${size ? ` ${size}` : ""}`}>
      <strong>{displayValue}</strong>
      <button
        type="button"
        className="copy-price-button"
        onClick={() => copyPrice(value)}
        aria-label={`Copy price ${displayValue}`}
        title="Copy price"
      >
        ⧉
      </button>
    </span>
  );
}

function renderTextWithPrices(text) {
  return String(text)
    .split(/(-?\d+(?:\.\d+)?)/g)
    .map((part, index) => {
      if (/^-?\d+(?:\.\d+)?$/.test(part)) {
        return <CopyPrice key={`${part}-${index}`} value={Number(part)} />;
      }

      return part;
    });
}

function normalizeCandle(candle, index = 0) {
  const epoch = Number(
    candle.epoch ?? (candle.time ? Date.parse(candle.time) / 1000 : index)
  );

  return {
    ...candle,
    epoch,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

/*
 * Find candidate retracement zones from the candles:
 * - Swing highs/lows: possible resistance/support.
 * - Bullish candles before a strong bearish move: possible supply/order block.
 * - Bearish candles before a strong bullish move: possible demand/order block.
 *
 * These are heuristic candidates, not verified institutional order blocks.
 */
function findRetracementZones(candles, avgBody, pad) {
  const zones = [];
  const start = Math.max(0, candles.length - 45);
  const recent = candles.slice(start);

  const addZone = (zone) => {
    if (
      Number.isFinite(zone.low) &&
      Number.isFinite(zone.high) &&
      zone.high > zone.low
    ) {
      zones.push(zone);
    }
  };

  for (let i = 2; i < recent.length - 2; i += 1) {
    const candle = recent[i];
    const before = recent[i - 1];
    const after = recent[i + 1];
    const absoluteIndex = start + i;

    const isSwingHigh =
      candle.high >= recent[i - 1].high &&
      candle.high >= recent[i - 2].high &&
      candle.high >= recent[i + 1].high &&
      candle.high >= recent[i + 2].high;

    const isSwingLow =
      candle.low <= recent[i - 1].low &&
      candle.low <= recent[i - 2].low &&
      candle.low <= recent[i + 1].low &&
      candle.low <= recent[i + 2].low;

    if (isSwingHigh) {
      addZone({
        type: "Resistance",
        low: Math.min(candle.open, candle.close),
        high: candle.high,
        index: absoluteIndex,
        source: "swing",
      });
    }

    if (isSwingLow) {
      addZone({
        type: "Support",
        low: candle.low,
        high: Math.max(candle.open, candle.close),
        index: absoluteIndex,
        source: "swing",
      });
    }

    // A bullish candle followed by a strong bearish displacement.
    const bearishDisplacement =
      after.close < after.open &&
      before.close < before.open &&
      Math.abs(after.close - after.open) >= avgBody * 1.15;

    if (candle.close > candle.open && bearishDisplacement) {
      addZone({
        type: "Supply / bearish order-block candidate",
        low: Math.min(candle.open, candle.close),
        high: candle.high,
        index: absoluteIndex,
        source: "orderblock",
      });
    }

    // A bearish candle followed by a strong bullish displacement.
    const bullishDisplacement =
      after.close > after.open &&
      before.close > before.open &&
      Math.abs(after.close - after.open) >= avgBody * 1.15;

    if (candle.close < candle.open && bullishDisplacement) {
      addZone({
        type: "Demand / bullish order-block candidate",
        low: candle.low,
        high: Math.max(candle.open, candle.close),
        index: absoluteIndex,
        source: "orderblock",
      });
    }
  }

  // Give recent zones priority while avoiding zones that are too wide.
  return zones
    .map((zone) => ({
      ...zone,
      width: zone.high - zone.low,
      age: candles.length - 1 - zone.index,
    }))
    .filter((zone) => zone.width <= Math.max(pad * 8, avgBody * 5));
}

function selectRetracementZone(zones, direction, currentPrice, pad) {
  const candidates = zones.filter((zone) => {
    if (direction === "SELL") {
      return zone.high > currentPrice + pad * 0.1;
    }

    return zone.low < currentPrice - pad * 0.1;
  });

  if (!candidates.length) return null;

  const scored = candidates.map((zone) => {
    const distance =
      direction === "SELL"
        ? Math.max(0, zone.low - currentPrice)
        : Math.max(0, currentPrice - zone.high);

    const sourceBonus = zone.source === "orderblock" ? pad * 0.25 : 0;
    const agePenalty = zone.age * pad * 0.002;

    return {
      ...zone,
      score: distance - sourceBonus + agePenalty,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  // Prefer the closest relevant zone price could retrace into.
  return scored[0];
}

function analyzeCandles(rawCandles) {
  const candles = (rawCandles || [])
    .map(normalizeCandle)
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    );

  if (candles.length < 5) {
    throw new Error("At least five valid candles are needed to analyze this market.");
  }

  const recent = candles.slice(-20);
  const last = candles.at(-1);
  const previous = candles.at(-2);

  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));

  const range = Math.max(
    recentHigh - recentLow,
    Math.abs(last.close) * 0.000001
  );

  const closes = candles.slice(-12).map((c) => c.close);
  const firstClose = closes[0] ?? last.close;
  const trendChange = last.close - firstClose;

  const trendPercent =
    Math.abs(firstClose) > 0
      ? Math.abs(trendChange / firstClose)
      : 0;

  const candleBodies = recent.map((c) => Math.abs(c.close - c.open));

  const avgBody =
    candleBodies.reduce((a, b) => a + b, 0) /
    Math.max(candleBodies.length, 1);

  const isConsolidating =
    (recentHigh - recentLow) / Math.max(Math.abs(last.close), 1e-9) <
      0.012 &&
    trendPercent < 0.008;

  const bullish =
    trendChange > 0 &&
    last.close > (previous?.close ?? last.close);

  const bearish =
    trendChange < 0 &&
    last.close < (previous?.close ?? last.close);

  const precision =
    Math.abs(last.close) < 10
      ? 5
      : Math.abs(last.close) < 1000
        ? 3
        : 2;

  const level = (n) => Number(n.toFixed(precision));

  const pad = Math.max(
    avgBody * 1.2,
    range * 0.08,
    Math.abs(last.close) * 0.0005
  );

  const targetDistance = Math.max(range * 0.45, pad * 1.5);

  const zones = findRetracementZones(candles, avgBody, pad);

  if (isConsolidating) {
    const buyEntry = level(recentHigh);
    const sellEntry = level(recentLow);

    return {
      action: "WAIT",
      setupType: "Breakout and retest",
      marketCondition: "Consolidation",
      recentHigh: level(recentHigh),
      recentLow: level(recentLow),
      rangeHigh: level(recentHigh),
      rangeLow: level(recentLow),
      paragraphs: [
        `Price has been moving sideways between ${fmt(level(recentLow))} and ${fmt(level(recentHigh))}. Neither side has clearly taken control, so entering in the middle of this range would mean guessing.`,
        "Wait for a candle to close outside the range, then see whether price returns to test that boundary and holds. A breakout that immediately falls back into the range is not confirmation.",
      ],
      waitFor:
        "Wait for a candle close outside the range, then a retest that holds. A bullish candle after an upper retest supports a buy idea; a bearish candle after a lower retest supports a sell idea.",
      buy: {
        entry: buyEntry,
        watchLow: level(recentHigh - pad * 0.25),
        watchHigh: level(recentHigh + pad * 0.25),
        zoneType: "Range resistance / breakout retest",
        stopLoss: level(recentHigh - pad),
        takeProfit: level(recentHigh + targetDistance),
        confirmation:
          "A candle closes above the range, price retests the upper boundary, then a bullish candle closes back above it.",
        invalidation:
          "Price falls back into the range and holds there. Cancel the buy idea and wait for the range to resolve again.",
      },
      sell: {
        entry: sellEntry,
        watchLow: level(recentLow - pad * 0.25),
        watchHigh: level(recentLow + pad * 0.25),
        zoneType: "Range support / breakdown retest",
        stopLoss: level(recentLow + pad),
        takeProfit: level(recentLow - targetDistance),
        confirmation:
          "A candle closes below the range, price retests the lower boundary, then a bearish candle closes back below it.",
        invalidation:
          "Price climbs back into the range and holds there. Cancel the sell idea and reassess; do not chase the failed breakout.",
      },
      invalidates:
        "An upside break is invalidated if price returns inside the range and holds there. A downside break is invalidated if price returns inside the range and holds there.",
      next:
        "If the breakout fails, cancel that directional idea and reassess the range. Do not immediately reverse without fresh confirmation.",
    };
  }

  if (bullish) {
    const selectedZone = selectRetracementZone(
      zones.filter((zone) =>
        ["Support", "Demand / bullish order-block candidate"].includes(zone.type)
      ),
      "BUY",
      last.close,
      pad
    );

    const fallbackLow = Math.min(recentLow, last.low);
    const watchLow = selectedZone
      ? level(selectedZone.low)
      : level(Math.max(fallbackLow, last.close - pad));

    const watchHigh = selectedZone
      ? level(selectedZone.high)
      : level(Math.max(watchLow + pad * 0.25, last.close - pad * 0.25));

    const entry = level((watchLow + watchHigh) / 2);
    const stop = level(Math.min(fallbackLow, watchLow) - pad * 0.15);
    const tp = level(Math.max(recentHigh, entry + targetDistance));

    const zoneType = selectedZone?.type || "Estimated support area";

    return {
      action: "BUY",
      setupType: "Bullish continuation · wait for pullback",
      marketCondition: "Bullish trend",
      recentHigh: level(recentHigh),
      recentLow: level(recentLow),
      rangeHigh: level(recentHigh),
      rangeLow: level(recentLow),
      paragraphs: [
        `Recent candles show buyers pushing price upward. The latest close is ${fmt(level(last.close))}, while the recent high and low are ${fmt(level(recentHigh))} and ${fmt(level(recentLow))}.`,
        `The bullish idea remains conditional. The potential retracement area is ${fmt(watchLow)} to ${fmt(watchHigh)}, based on ${zoneType.toLowerCase()}. Wait for price to return to this area and show bullish rejection; do not chase the current price.`,
      ],
      waitFor:
        `Watch the ${zoneType.toLowerCase()} between ${fmt(watchLow)} and ${fmt(watchHigh)}. Wait for price to retrace into the zone and a bullish confirmation candle to close. If price breaks decisively below the zone, stand aside.`,
      buy: {
        entry,
        watchLow,
        watchHigh,
        zoneType,
        stopLoss: stop,
        takeProfit: tp,
        confirmation:
          "Price retraces into the marked support, demand, or order-block area, holds, and a bullish candle closes upward.",
        invalidation:
          "Price breaks below the selected retracement zone and the recent swing low, then fails to reclaim the area. Cancel the buy idea.",
      },
      sell: null,
      invalidates:
        "A decisive move below the selected retracement zone and recent swing low weakens or invalidates the bullish structure.",
      next:
        "Wait for price to revisit the marked area and confirm bullish rejection. The zone is an area to assess, not an instruction to enter automatically.",
    };
  }

  if (bearish) {
    const selectedZone = selectRetracementZone(
      zones.filter((zone) =>
        ["Resistance", "Supply / bearish order-block candidate"].includes(zone.type)
      ),
      "SELL",
      last.close,
      pad
    );

    const fallbackHigh = Math.max(recentHigh, last.high);
    const watchLow = selectedZone
      ? level(selectedZone.low)
      : level(Math.min(fallbackHigh, last.close + pad * 0.25));

    const watchHigh = selectedZone
      ? level(selectedZone.high)
      : level(Math.max(watchLow + pad * 0.25, last.close + pad));

    const entry = level((watchLow + watchHigh) / 2);
    const stop = level(Math.max(fallbackHigh, watchHigh) + pad * 0.15);
    const tp = level(Math.min(recentLow, entry - targetDistance));

    const zoneType = selectedZone?.type || "Estimated resistance area";

    return {
      action: "SELL",
      setupType: "Bearish continuation · wait for pullback",
      marketCondition: "Bearish trend",
      recentHigh: level(recentHigh),
      recentLow: level(recentLow),
      rangeHigh: level(recentHigh),
      rangeLow: level(recentLow),
      paragraphs: [
        `Recent candles show sellers pushing price downward. The latest close is ${fmt(level(last.close))}, while the recent high and low are ${fmt(level(recentHigh))} and ${fmt(level(recentLow))}.`,
        `The bearish idea remains conditional. The potential retracement area is ${fmt(watchLow)} to ${fmt(watchHigh)}, based on ${zoneType.toLowerCase()}. Wait for price to return to this area and show bearish rejection; do not sell simply because price has already fallen.`,
      ],
      waitFor:
        `Watch the ${zoneType.toLowerCase()} between ${fmt(watchLow)} and ${fmt(watchHigh)}. Wait for price to retrace into the zone and a bearish confirmation candle to close. If price breaks decisively above the zone, stand aside.`,
      buy: null,
      sell: {
        entry,
        watchLow,
        watchHigh,
        zoneType,
        stopLoss: stop,
        takeProfit: tp,
        confirmation:
          "Price retraces into the marked resistance, supply, or order-block area, fails to break through, and a bearish candle closes downward.",
        invalidation:
          "Price breaks above the selected retracement zone and the recent swing high, then holds above it. Cancel the sell idea.",
      },
      invalidates:
        "A decisive move above the selected retracement zone and recent swing high weakens or invalidates the bearish structure.",
      next:
        "Wait for price to revisit the marked area and confirm bearish rejection. The zone is an area to assess, not an instruction to enter automatically.",
    };
  }

  return {
    action: "WAIT",
    setupType: "Wait for structure to clarify",
    marketCondition: "Mixed / unclear",
    recentHigh: level(recentHigh),
    recentLow: level(recentLow),
    rangeHigh: level(recentHigh),
    rangeLow: level(recentLow),
    paragraphs: [
      `Price has not shown a clear directional advantage in the latest candles. The recent high is ${fmt(level(recentHigh))} and the recent low is ${fmt(level(recentLow))}.`,
      "Wait for a clear close beyond one of these levels and then look for follow-through or a retest. Until then, the next direction is uncertain and an entry would be premature.",
    ],
    waitFor:
      "Wait for a candle close above the recent high or below the recent low, then look for a retest and a confirming candle in that direction.",
    buy: {
      entry: level(recentHigh),
      watchLow: level(recentHigh - pad * 0.25),
      watchHigh: level(recentHigh + pad * 0.25),
      zoneType: "Range resistance / breakout retest",
      stopLoss: level(recentHigh - pad),
      takeProfit: level(recentHigh + targetDistance),
      confirmation:
        "A candle closes above the recent high and a retest holds with a bullish close.",
      invalidation:
        "Price returns below the broken level and holds there.",
    },
    sell: {
      entry: level(recentLow),
      watchLow: level(recentLow - pad * 0.25),
      watchHigh: level(recentLow + pad * 0.25),
      zoneType: "Range support / breakdown retest",
      stopLoss: level(recentLow + pad),
      takeProfit: level(recentLow - targetDistance),
      confirmation:
        "A candle closes below the recent low and a retest holds with a bearish close.",
      invalidation:
        "Price returns above the broken level and holds there.",
    },
    invalidates:
      "A breakout that closes back inside the prior range and holds there is not confirmed.",
    next:
      "Wait for fresh structure. Do not force a trade in the middle of an unclear market.",
  };
}

function CandleChart({ candles }) {
  const visible = candles.slice(-70);

  if (!visible.length) return null;

  const width = 820;
  const height = 290;
  const left = 8;
  const right = 54;
  const top = 16;
  const bottom = 18;

  const values = visible.flatMap((c) => [c.high, c.low]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1e-9);

  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const y = (price) => top + ((max - price) / span) * plotHeight;

  const step = plotWidth / visible.length;
  const bodyWidth = Math.max(2, Math.min(8, step * 0.62));

  const priceLabels = Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4;

    return {
      price: max - span * fraction,
      y: top + plotHeight * fraction,
    };
  });

  return (
    <div className="chart-wrap">
      <div className="chart-topline">
        <span>PRICE HISTORY</span>
        <span>
          {visible.length} candles · {formatCandleTime(visible.at(-1)?.epoch)}
        </span>
      </div>

      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Historical candlestick chart with a compact right-side price scale"
      >
        {visible.map((c, i) => {
          const x = left + i * step + step / 2;
          const up = c.close >= c.open;
          const bodyY = y(Math.max(c.open, c.close));
          const bodyHeight = Math.max(
            1.5,
            Math.abs(y(c.open) - y(c.close))
          );

          return (
            <g key={`${c.epoch ?? i}-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={y(c.high)}
                y2={y(c.low)}
                className={up ? "candle-wick up" : "candle-wick down"}
              />
              <rect
                x={x - bodyWidth / 2}
                y={bodyY}
                width={bodyWidth}
                height={bodyHeight}
                rx="1"
                className={up ? "candle-body up" : "candle-body down"}
              />
            </g>
          );
        })}

        {priceLabels.map(({ price, y: labelY }, index) => (
          <text
            key={`price-${index}`}
            x={width - right + 4}
            y={labelY}
            textAnchor="start"
            dominantBaseline={
              index === 0
                ? "hanging"
                : index === priceLabels.length - 1
                  ? "auto"
                  : "middle"
            }
            className="chart-price-label"
          >
            {formatAxisPrice(price)}
          </text>
        ))}
      </svg>

      <div className="chart-axis">
        <span>{formatCandleTime(visible[0]?.epoch)}</span>
        <span>{formatCandleTime(visible.at(-1)?.epoch)}</span>
      </div>
    </div>
  );
}

function TimeframeDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selected =
    options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className={`timeframe-dropdown${open ? " is-open" : ""}`}
      ref={dropdownRef}
    >
      <button
        type="button"
        className="timeframe-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="timeframe-trigger-label">{selected.label}</span>

        <svg
          className="timeframe-chevron"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
        </svg>
      </button>

      {open && (
        <div
          className="timeframe-menu"
          role="listbox"
          aria-label="Candle timeframe"
        >
          <div className="timeframe-menu-heading">
            <span>TIMEFRAME</span>
            <span>{options.length} options</span>
          </div>

          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                key={option.value}
                className={`timeframe-option${active ? " active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="timeframe-option-label">
                  {option.label}
                </span>

                {active && (
                  <svg
                    className="timeframe-option-check"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path d="m4 10 4 4 8-8" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PriceStat({ label, value }) {
  const isPrice = typeof value === "number" && Number.isFinite(value);

  return (
    <div className="price-stat">
      <span className="price-stat-label">{label}</span>
      {isPrice ? <CopyPrice value={value} /> : <strong>{fmt(value)}</strong>}
    </div>
  );
}

function ScenarioCard({ side, scenario }) {
  if (!scenario) return null;

  const buy = side === "BUY";
  const watchLow = scenario.watchLow ?? scenario.entry;
  const watchHigh = scenario.watchHigh ?? scenario.entry;
  const hasRange = watchLow !== watchHigh;

  return (
    <article className={`scenario-card ${buy ? "scenario-buy" : "scenario-sell"}`}>
      <div className="scenario-heading">
        <span className={`signal-pill ${buy ? "buy-pill" : "sell-pill"}`}>
          {side}
        </span>
        <span>{buy ? "If price breaks upward" : "If price breaks downward"}</span>
      </div>

      <div className="scenario-watch">
        <p>
          WATCH RETRACEMENT ZONE
        </p>
        <div className="scenario-watch-prices">
          <CopyPrice value={watchLow} />
          {hasRange && (
            <>
              <span className="scenario-watch-separator">–</span>
              <CopyPrice value={watchHigh} />
            </>
          )}
        </div>
        <p className="scenario-zone-type">
          {scenario.zoneType || "Potential price area"}
        </p>
        <p>
          Wait for a retest {buy ? "from above" : "from below"} and confirmation.
        </p>
      </div>

      <div className="risk-grid">
        <PriceStat label="POTENTIAL SL" value={scenario.stopLoss} />
        <PriceStat label="POTENTIAL TP" value={scenario.takeProfit} />
      </div>

      <div className="scenario-copy">
        <h4>CONFIRMATION</h4>
        <p>{scenario.confirmation}</p>
      </div>

      <div className="scenario-copy">
        <h4>IF INVALIDATED</h4>
        <p>{scenario.invalidation}</p>
      </div>
    </article>
  );
}

export default function App() {
  const [market, setMarket] = useState(null);
  const [search, setSearch] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [timeframe, setTimeframe] = useState(900);
  const [candles, setCandles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState("Not connected");
  const [error, setError] = useState("");
  const [cryptoMarkets, setCryptoMarkets] = useState([]);
  const [cryptoStatus, setCryptoStatus] = useState("Loading crypto markets…");

  useEffect(() => {
    let cancelled = false;

    async function loadCryptoMarkets() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/coingecko/markets`);
        const contentType = response.headers.get("content-type") || "";

        if (!contentType.toLowerCase().includes("application/json")) {
          const bodyPreview = (await response.text())
            .replace(/\s+/g, " ")
            .slice(0, 100);

          throw new Error(
            `Expected JSON from ${API_BASE_URL}/api/coingecko/markets but received HTML or another content type. Stop duplicate servers, restart server.js on port 3001, and try again. Response: ${bodyPreview}`
          );
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "CoinGecko market list request failed.");
        }

        if (!Array.isArray(data.markets)) {
          throw new Error(
            data.error || "CoinGecko response did not contain a markets array."
          );
        }

        const markets = data.markets.map((coin) => ({
          label: `${coin.name} (${String(coin.symbol || "").toUpperCase()})`,
          category: "Crypto · CoinGecko spot data",
          symbol: coin.id,
          provider: "coingecko",
          baseAsset: coin.symbol,
          currentPrice: coin.currentPrice,
          marketCapRank: coin.marketCapRank,
        }));

        if (!cancelled) {
          setCryptoMarkets(markets);
          setCryptoStatus(`${markets.length} crypto markets available`);
        }
      } catch (err) {
        if (!cancelled) {
          setCryptoStatus(
            `Crypto list unavailable: ${err?.message || "unknown error"}`
          );
          console.error("CoinGecko market list unavailable:", err);
        }
      }
    }

    loadCryptoMarkets();

    return () => {
      cancelled = true;
    };
  }, []);

  const allMarkets = useMemo(
    () => [...BASE_MARKETS, ...cryptoMarkets],
    [cryptoMarkets]
  );

  const filteredMarkets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = query ? allMarkets : BASE_MARKETS;

    return source.filter((item) =>
      `${item.label} ${item.category} ${item.symbol} ${item.baseAsset || ""}`
        .toLowerCase()
        .includes(query)
    );
  }, [allMarkets, search]);

  function chooseMarket(item) {
    setMarket(item);
    setSearch(item.label);
    setSuggestionsOpen(false);
    setAnalysis(null);
    setCandles([]);
    setError("");
  }

  function chooseTimeframe(value) {
    setTimeframe(value);
    setAnalysis(null);
    setCandles([]);
    setError("");
  }

  async function runAnalysis(event) {
    event?.preventDefault();

    if (!market) {
      setError("Choose a market before running an analysis.");
      setSuggestionsOpen(true);
      return;
    }

    setLoading(true);
    setError("");
    setAnalysis(null);
    setCandles([]);

    let client = null;

    try {
      let data;

      if (isCrypto(market)) {
        setConnection("Requesting Binance historical crypto candles…");

        const params = new URLSearchParams({
          provider: "binance",
          symbol: `${String(market.baseAsset || "").toUpperCase()}USDT`,
          timeframe:
            TIMEFRAMES.find((tf) => tf.value === timeframe)?.apiValue || "15m",
          limit: "120",
        });

        const response = await fetch(
          `${API_BASE_URL}/api/candles?${params.toString()}`
        );

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "Backend returned non-JSON candle data. Confirm server.js is running on port 3001."
          );
        }

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error || "Could not retrieve Binance crypto candles."
          );
        }

        if (!Array.isArray(result.candles)) {
          throw new Error("Binance returned an invalid candle list.");
        }

        data = result.candles.map(normalizeCandle);
        setConnection("Connected · Binance public crypto data");
      } else {
        setConnection("Connecting to Deriv market data…");

        client = await connectToDeriv();
        data = await getCandles(client, market.symbol, timeframe, 120);

        if (!data?.length) {
          throw new Error(
            "Deriv returned no candles for this symbol. Confirm the symbol is supported by your Deriv API."
          );
        }

        data = data.map(normalizeCandle);
        setConnection("Data received · Deriv connection closed");
      }

      if (!data.length) {
        throw new Error("The selected market returned no usable candles.");
      }

      setCandles(data);
      setAnalysis(analyzeCandles(data));

      setConnection(
        isCrypto(market)
          ? "Data received · Binance"
          : "Data received · Deriv connection closed"
      );
    } catch (err) {
      setConnection("Connection unavailable");
      setError(err?.message || "Could not retrieve historical candle data.");
    } finally {
      if (client?.close) {
        try {
          client.close();
        } catch {
          // No-op.
        }
      }

      setLoading(false);
    }
  }

  const providerDescription = isCrypto(market)
    ? "Requesting Binance public crypto candles. No orders will be placed."
    : "Connecting to Deriv and requesting historical candles. No orders will be placed.";

  return (
    <main className="nox-app">
      <header className="brand-header">
        <img className="nox-logo" src="/Nox.png" alt="NOX logo" />
        <h1 className="brand-name">NOX</h1>
        <div className="brand-divider" />
        <p className="eyebrow">MARKET INTELLIGENCE · RESEARCH MODE</p>
      </header>

      <section className="search-section">
        <div className="section-heading">
          <div>
            <h2>Select a market</h2>
            <p>Inspect recent price behaviour and map a conditional setup.</p>
          </div>
        </div>

        <form className="market-form" onSubmit={runAnalysis}>
          <div className="search-box">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setMarket(null);
                setSuggestionsOpen(true);
                setAnalysis(null);
                setCandles([]);
                setError("");
              }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="Search synthetic indices, forex, metals or crypto…"
              aria-label="Search markets"
              autoComplete="off"
            />

            {market && (
              <button
                className="clear-selection"
                type="button"
                onClick={() => {
                  setMarket(null);
                  setSearch("");
                  setAnalysis(null);
                  setCandles([]);
                  setError("");
                  setSuggestionsOpen(true);
                }}
                aria-label="Clear market"
              >
                ×
              </button>
            )}
          </div>

          {suggestionsOpen && (
            <div className="market-suggestions">
              {filteredMarkets.slice(0, 10).map((item) => (
                <button
                  type="button"
                  className="suggestion"
                  key={`${item.provider}-${item.symbol}`}
                  onClick={() => chooseMarket(item)}
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.category} · {item.symbol}</small>
                  </span>
                  <span className="suggestion-arrow">↗</span>
                </button>
              ))}

              {!filteredMarkets.length && (
                <div className="empty-suggestions">
                  No matching markets. {cryptoStatus}
                </div>
              )}
            </div>
          )}

          {market && (
            <div className="selected-market">
              <span className="status-dot" />
              <span>
                Selected: <strong>{market.label}</strong>
              </span>
            </div>
          )}

          <label className="timeframe-label">
            Candle timeframe
          </label>

          <TimeframeDropdown
            value={timeframe}
            options={TIMEFRAMES}
            onChange={chooseTimeframe}
          />

          {error && <p className="form-error">{error}</p>}

          <button className="analyze-button" type="submit" disabled={loading}>
            <span>{loading ? "ANALYZING MARKET…" : "ANALYZE MARKET"}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </form>

        <p className="search-note">
          Research mode · No live orders enabled · Signals are not financial advice
        </p>

        <p className="connection-status">
          <span
            className={
              connection.includes("Data received") || connection.includes("Connected")
                ? "status-dot"
                : "status-dot muted"
            }
          />
          {connection}
        </p>

        <p className="crypto-status">{cryptoStatus}</p>
      </section>

      {loading && (
        <section className="analysis-loader">
          <div className="loader-orbit">
            <img className="loader-logo" src="/Nox.png" alt="" />
          </div>
          <h2>Reading market data</h2>
          <p className="loader-description">{providerDescription}</p>
        </section>
      )}

      {candles.length > 0 && !loading && (
        <section className="chart-section">
          <div className="section-heading">
            <div>
              <h2>Price action</h2>
              <p>
                {market?.label} · {TIMEFRAMES.find((tf) => tf.value === timeframe)?.label}
              </p>
            </div>
            <span className="chart-live-tag">HISTORICAL DATA</span>
          </div>

          <CandleChart candles={candles} />
        </section>
      )}

      {analysis && !loading && (
        <section className="report-section">
          <div className="report-header">
            <div>
              <p className="eyebrow">MARKET REPORT</p>
              <h2>What price is showing</h2>
            </div>
            <span className={`action-badge ${analysis.action.toLowerCase()}`}>
              {analysis.action}
            </span>
          </div>

          <div className="analysis-paragraphs">
            {analysis.paragraphs.map((paragraph, index) => (
              <p className="analysis-paragraph" key={index}>
                {renderTextWithPrices(paragraph)}
              </p>
            ))}
          </div>

          <div className="signal-card">
            <div className="signal-card-top">
              <div>
                <span className="field-label">ACTION</span>
                <h3>{analysis.action}</h3>
              </div>

              <div className="setup-type">
                <span className="field-label">SETUP TYPE</span>
                <strong>{analysis.setupType}</strong>
              </div>
            </div>

            {analysis.action === "WAIT" && (
              <div className="wait-message">
                <h4>WHAT TO WAIT FOR</h4>
                <p>{analysis.waitFor}</p>
              </div>
            )}

            {analysis.action === "WAIT" ? (
              <div className="scenario-grid">
                <ScenarioCard side="BUY" scenario={analysis.buy} />
                <ScenarioCard side="SELL" scenario={analysis.sell} />
              </div>
            ) : (
              <div className="scenario-grid scenario-grid-single">
                <ScenarioCard
                  side={analysis.action}
                  scenario={analysis.action === "BUY" ? analysis.buy : analysis.sell}
                />
              </div>
            )}

            <div className="report-detail">
              <h4>WHAT INVALIDATES THE IDEA</h4>
              <p>{analysis.invalidates}</p>
            </div>

            <div className="report-detail">
              <h4>WHAT TO DO NEXT</h4>
              <p>{analysis.next}</p>
            </div>
          </div>

          <div className="market-stats">
            <PriceStat label="RECENT HIGH" value={analysis.recentHigh} />
            <PriceStat label="RECENT LOW" value={analysis.recentLow} />
            <div className="price-stat">
              <span className="price-stat-label">MARKET CONDITION</span>
              <strong>{analysis.marketCondition}</strong>
            </div>
          </div>

          <p className="method-note">
            Recent high/low use the highest high and lowest low among the latest
            20 returned candles. Retracement zones are heuristic estimates
            based on recent candle structure, not verified institutional order
            blocks. Entry, stop and target levels are not guaranteed outcomes.
            Confirm the setup on the chart before considering any trade.
          </p>
        </section>
      )}

      <footer className="site-footer">
        <img className="footer-logo" src="/Nox.png" alt="Nox" />
        <span>NOX · MARKET INTELLIGENCE</span>
        <span>RESEARCH MODE</span>
      </footer>
    </main>
  );
}
