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

const isCrypto = (market) => market?.provider === "binance";

const fmt = (value) =>
  value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value))
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
 * Find possible swing support, swing resistance, supply and demand areas.
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

  return scored[0];
}

const MAX_MEMORY_CANDLES = 600;
const MAX_MEMORY_OBSERVATIONS = 30;

function getChartMemoryKey(market, timeframe) {
  const provider = isCrypto(market) ? "binance" : "deriv";
  const symbol = String(market?.exchangeSymbol || market?.symbol || "").toUpperCase();
  return `nox.chartMemory.v1:${provider}:${symbol}:${timeframe}`;
}

function readChartMemory(storageKey) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    return {
      candles: Array.isArray(saved?.candles) ? saved.candles : [],
      observations: Array.isArray(saved?.observations) ? saved.observations : [],
    };
  } catch {
    return { candles: [], observations: [] };
  }
}

function mergeCandleHistory(previous, incoming) {
  const byEpoch = new Map();
  [...(previous || []), ...(incoming || [])].forEach((raw, index) => {
    const candle = normalizeCandle(raw, index);
    if (
      Number.isFinite(candle.epoch) &&
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    ) {
      byEpoch.set(candle.epoch, candle);
    }
  });
  return [...byEpoch.values()]
    .sort((a, b) => a.epoch - b.epoch)
    .slice(-MAX_MEMORY_CANDLES);
}

function findSwingPoints(candles) {
  const highs = [];
  const lows = [];
  const start = Math.max(0, candles.length - 100);
  const sample = candles.slice(start);
  for (let i = 2; i < sample.length - 2; i += 1) {
    const candle = sample[i];
    if (
      candle.high >= sample[i - 1].high &&
      candle.high >= sample[i - 2].high &&
      candle.high > sample[i + 1].high &&
      candle.high > sample[i + 2].high
    ) highs.push({ price: candle.high, epoch: candle.epoch });
    if (
      candle.low <= sample[i - 1].low &&
      candle.low <= sample[i - 2].low &&
      candle.low < sample[i + 1].low &&
      candle.low < sample[i + 2].low
    ) lows.push({ price: candle.low, epoch: candle.epoch });
  }
  return { highs: highs.slice(-4), lows: lows.slice(-4) };
}

function buildMarketStory(rawCandles, previousObservation = null) {
  const candles = (rawCandles || [])
    .map(normalizeCandle)
    .filter((c) => Number.isFinite(c.epoch) && [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.epoch - b.epoch);
  if (candles.length < 5) return null;

  const recent = candles.slice(-20);
  const preceding = candles.slice(-40, -20);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const longWindow = candles.slice(-Math.min(300, candles.length));
  const high20 = Math.max(...recent.map((c) => c.high));
  const low20 = Math.min(...recent.map((c) => c.low));
  const highLong = Math.max(...longWindow.map((c) => c.high));
  const lowLong = Math.min(...longWindow.map((c) => c.low));
  const startPrice = longWindow[0].open || longWindow[0].close;
  const changePercent = startPrice ? ((last.close - startPrice) / startPrice) * 100 : 0;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const recentRanges = recent.slice(-10).map((c) => c.high - c.low);
  const previousRanges = (preceding.length ? preceding : recent.slice(0, 10)).slice(-10).map((c) => c.high - c.low);
  const recentRangeMean = mean(recentRanges);
  const previousRangeMean = mean(previousRanges);
  const volatilityRatio = previousRangeMean > 0 ? recentRangeMean / previousRangeMean : 1;
  const rangePosition = high20 > low20 ? ((last.close - low20) / (high20 - low20)) * 100 : 50;
  const candleRange = Math.max(last.high - last.low, 1e-12);
  const bodyStrength = Math.abs(last.close - last.open) / candleRange;
  const closeLocation = ((last.close - last.low) / candleRange) * 100;
  const swings = findSwingPoints(candles);
  const lastTwoHighs = swings.highs.slice(-2);
  const lastTwoLows = swings.lows.slice(-2);
  let structure = "Mixed swing structure";
  if (lastTwoHighs.length === 2 && lastTwoLows.length === 2) {
    const higherHigh = lastTwoHighs[1].price > lastTwoHighs[0].price;
    const higherLow = lastTwoLows[1].price > lastTwoLows[0].price;
    const lowerHigh = lastTwoHighs[1].price < lastTwoHighs[0].price;
    const lowerLow = lastTwoLows[1].price < lastTwoLows[0].price;
    if (higherHigh && higherLow) structure = "Higher highs and higher lows";
    else if (lowerHigh && lowerLow) structure = "Lower highs and lower lows";
  }

  const rangePercent = ((high20 - low20) / Math.max(Math.abs(last.close), 1e-9)) * 100;
  const nearTop = rangePosition >= 80;
  const nearBottom = rangePosition <= 20;
  const volatility = volatilityRatio >= 1.25 ? "Expanding" : volatilityRatio <= 0.8 ? "Contracting" : "Steady";
  const candleDirection = last.close > last.open ? "Bullish" : last.close < last.open ? "Bearish" : "Neutral";
  const historicalDirection = changePercent > 0.15 ? "rose" : changePercent < -0.15 ? "fell" : "finished near its starting price";
  const history = `${longWindow.length} completed candles: price ${historicalDirection}${Math.abs(changePercent) > 0.15 ? ` by ${Math.abs(changePercent).toFixed(2)}%` : ""}. The wider observed range is ${fmt(lowLong)}–${fmt(highLong)}. Recent swing structure: ${structure.toLowerCase()}.`;
  const current = `Latest completed candle closed at ${fmt(last.close)} (${candleDirection.toLowerCase()}); its body used ${(bodyStrength * 100).toFixed(0)}% of its range and it closed at ${closeLocation.toFixed(0)}% of its own candle range. Price is at ${rangePosition.toFixed(0)}% of the latest 20-candle range${nearTop ? ", near the range high" : nearBottom ? ", near the range low" : ", in the middle portion of the range"}, and short-term volatility is ${volatility.toLowerCase()}.`;

  let changeSinceLastCheck;
  if (!previousObservation) {
    changeSinceLastCheck = "This is the first saved observation for this market and timeframe; future checks will be compared with it.";
  } else if (Number(previousObservation.epoch) === Number(last.epoch)) {
    changeSinceLastCheck = "No new completed candle has formed since the previous check. Keep the recorded structure and plan context; do not treat a repeated scan as new evidence.";
  } else {
    const previousClose = Number(previousObservation.close);
    const closeDelta = Number.isFinite(previousClose) ? last.close - previousClose : 0;
    const deltaText = closeDelta === 0
      ? "the close is unchanged"
      : `the close moved ${closeDelta > 0 ? "up" : "down"} ${fmt(Math.abs(closeDelta))}`;
    const structureText = previousObservation.structure && previousObservation.structure !== structure
      ? `swing structure changed from ${String(previousObservation.structure).toLowerCase()} to ${structure.toLowerCase()}`
      : `swing structure remains ${structure.toLowerCase()}`;
    const oldPosition = Number(previousObservation.rangePosition);
    const positionText = Number.isFinite(oldPosition)
      ? `; range position shifted from ${oldPosition.toFixed(0)}% to ${rangePosition.toFixed(0)}%`
      : "";
    changeSinceLastCheck = `Since the last saved completed candle, ${deltaText}; ${structureText}${positionText}.`;
  }

  let anticipation;
  if (structure === "Higher highs and higher lows") {
    anticipation = [
      { title: "Continuation condition", detail: `A completed close above ${fmt(high20)} would show renewed upward expansion; a retest that holds would strengthen that path.` },
      { title: "Pullback / failure condition", detail: `A pullback may test recent support around ${fmt(low20)}. A completed close below ${fmt(low20)} would weaken the bullish structure; do not assume support must hold.` },
    ];
  } else if (structure === "Lower highs and lower lows") {
    anticipation = [
      { title: "Continuation condition", detail: `A completed close below ${fmt(low20)} would show renewed downward expansion; a failed retest of that level would strengthen that path.` },
      { title: "Pullback / failure condition", detail: `A rebound may test recent resistance around ${fmt(high20)}. A completed close above ${fmt(high20)} would weaken the bearish structure; do not assume resistance must hold.` },
    ];
  } else {
    anticipation = [
      { title: "Upside scenario", detail: `A completed close above ${fmt(high20)} followed by a retest that holds would be evidence of an upside break. A wick alone is not enough.` },
      { title: "Downside scenario", detail: `A completed close below ${fmt(low20)} followed by a retest that fails would be evidence of a downside break. A wick alone is not enough.` },
    ];
  }

  let presentBias = "Mixed / awaiting clearer structure";
  if (structure === "Higher highs and higher lows") presentBias = "Bullish structure; confirmation still required";
  if (structure === "Lower highs and lower lows") presentBias = "Bearish structure; confirmation still required";
  if (rangePercent < 0.35) presentBias = "Compressed range; breakout not yet established";

  return {
    candleCount: candles.length,
    latestEpoch: last.epoch,
    latestClose: last.close,
    history,
    current,
    changeSinceLastCheck,
    structure,
    presentBias,
    volatility,
    rangePosition: Number(rangePosition.toFixed(1)),
    recentHigh: high20,
    recentLow: low20,
    widerHigh: highLong,
    widerLow: lowLong,
    anticipation,
  };
}
function recordChartObservation(memory, story) {
  if (!story) return memory;
  const observations = Array.isArray(memory.observations) ? [...memory.observations] : [];
  const last = observations.at(-1);
  if (Number(last?.epoch) !== Number(story.latestEpoch)) {
    observations.push({
      epoch: story.latestEpoch,
      savedAt: Date.now(),
      close: story.latestClose,
      structure: story.structure,
      presentBias: story.presentBias,
      volatility: story.volatility,
      rangePosition: story.rangePosition,
      history: story.history,
      current: story.current,
      changeSinceLastCheck: story.changeSinceLastCheck,
      recentHigh: story.recentHigh,
      recentLow: story.recentLow,
      widerHigh: story.widerHigh,
      widerLow: story.widerLow,
    });
  }
  return { ...memory, candles: (memory.candles || []).slice(-MAX_MEMORY_CANDLES), observations: observations.slice(-MAX_MEMORY_OBSERVATIONS) };
}

function analyzeCandles(rawCandles) {
  const candles = (rawCandles || [])
    .map(normalizeCandle)
    .filter((c) =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    );

  if (candles.length < 5) {
    throw new Error(
      "At least five valid candles are needed to analyze this market."
    );
  }

  const recent = candles.slice(-20);
  const last = candles.at(-1);
  const previous = candles.at(-2);

  // The structural stop levels are based on these recent swing extremes.
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const swingLow = Math.min(...recent.map((c) => c.low));

  const range = Math.max(
    swingHigh - swingLow,
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
    (swingHigh - swingLow) / Math.max(Math.abs(last.close), 1e-9) <
      0.012 &&
    trendPercent < 0.008;

  // A directional setup needs agreement between broader swing structure and
  // recent momentum. One isolated candle must not flip the entire analysis.
  const story = buildMarketStory(candles);
  const shortMomentum = last.close - (candles.at(-5)?.close ?? firstClose);
  const bullish =
    story?.structure === "Higher highs and higher lows" &&
    trendChange > 0 &&
    shortMomentum > 0 &&
    last.close > (previous?.close ?? last.close);

  const bearish =
    story?.structure === "Lower highs and lower lows" &&
    trendChange < 0 &&
    shortMomentum < 0 &&
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
    return {
      action: "WAIT",
      setupType: "Breakout and retest",
      marketCondition: "Consolidation",
      recentHigh: level(swingHigh),
      recentLow: level(swingLow),
      rangeHigh: level(swingHigh),
      rangeLow: level(swingLow),
      paragraphs: [
        `Price has been moving sideways between ${fmt(level(swingLow))} and ${fmt(level(swingHigh))}. Neither side has clearly taken control, so entering in the middle of this range would mean guessing.`,
        "Wait for a candle to close outside the range, then see whether price returns to test that boundary and holds. A breakout that immediately falls back into the range is not confirmation.",
      ],
      waitFor:
        "Wait for a candle close outside the range, then a retest that holds. A bullish candle after an upper retest supports a buy idea; a bearish candle after a lower retest supports a sell idea.",
      buy: {
        entry: level(swingHigh),
        watchLow: level(swingHigh - pad * 0.25),
        watchHigh: level(swingHigh + pad * 0.25),
        zoneType: "Range resistance / breakout retest",
        stopLoss: level(swingLow),
        takeProfit: level(swingHigh + targetDistance),
        confirmation:
          "A candle closes above the range, price retests the upper boundary, then a bullish candle closes back above it.",
        invalidation:
          "Price falls back into the range and holds there. Cancel the buy idea and wait for the range to resolve again.",
      },
      sell: {
        entry: level(swingLow),
        watchLow: level(swingLow - pad * 0.25),
        watchHigh: level(swingLow + pad * 0.25),
        zoneType: "Range support / breakdown retest",
        stopLoss: level(swingHigh),
        takeProfit: level(swingLow - targetDistance),
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
        ["Support", "Demand / bullish order-block candidate"].includes(
          zone.type
        )
      ),
      "BUY",
      last.close,
      pad
    );

    const watchLow = selectedZone
      ? level(selectedZone.low)
      : level(Math.max(swingLow, last.close - pad));

    const watchHigh = selectedZone
      ? level(selectedZone.high)
      : level(Math.max(watchLow + pad * 0.25, last.close - pad * 0.25));

    const entry = level((watchLow + watchHigh) / 2);
    const stop = level(swingLow);
    const tp = level(Math.max(swingHigh, entry + targetDistance));
    const zoneType = selectedZone?.type || "Estimated support area";

    return {
      action: "BUY",
      setupType: "Bullish continuation · wait for pullback",
      marketCondition: "Bullish trend",
      recentHigh: level(swingHigh),
      recentLow: level(swingLow),
      rangeHigh: level(swingHigh),
      rangeLow: level(swingLow),
      paragraphs: [
        `Recent candles show buyers pushing price upward. The latest close is ${fmt(level(last.close))}, while the recent high and low are ${fmt(level(swingHigh))} and ${fmt(level(swingLow))}.`,
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
        confirmation: "Price retraces into the marked support, demand, or order-block area, holds, and a completed bullish candle closes upward.",
        invalidation:
          "Price breaks below the selected retracement zone and recent swing low, then fails to reclaim the area. Cancel the buy idea.",
      },
      sell: null,
      invalidates:
        "A decisive move below the recent swing low weakens or invalidates the bullish structure.",
      next:
        "Wait for price to revisit the marked area and confirm bullish rejection. The zone is an area to assess, not an instruction to enter automatically.",
    };
  }

  if (bearish) {
    const selectedZone = selectRetracementZone(
      zones.filter((zone) =>
        ["Resistance", "Supply / bearish order-block candidate"].includes(
          zone.type
        )
      ),
      "SELL",
      last.close,
      pad
    );

    const watchLow = selectedZone
      ? level(selectedZone.low)
      : level(Math.min(swingHigh, last.close + pad * 0.25));

    const watchHigh = selectedZone
      ? level(selectedZone.high)
      : level(Math.max(watchLow + pad * 0.25, last.close + pad));

    const entry = level((watchLow + watchHigh) / 2);
    const stop = level(swingHigh);
    const tp = level(Math.min(swingLow, entry - targetDistance));
    const zoneType = selectedZone?.type || "Estimated resistance area";

    return {
      action: "SELL",
      setupType: "Bearish continuation · wait for pullback",
      marketCondition: "Bearish trend",
      recentHigh: level(swingHigh),
      recentLow: level(swingLow),
      rangeHigh: level(swingHigh),
      rangeLow: level(swingLow),
      paragraphs: [
        `Recent candles show sellers pushing price downward. The latest close is ${fmt(level(last.close))}, while the recent high and low are ${fmt(level(swingHigh))} and ${fmt(level(swingLow))}.`,
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
        confirmation: "Price retraces into the marked resistance, supply, or order-block area, fails to break through, and a completed bearish candle closes downward.",
        invalidation:
          "Price breaks above the selected retracement zone and recent swing high, then holds above it. Cancel the sell idea.",
      },
      invalidates:
        "A decisive move above the recent swing high weakens or invalidates the bearish structure.",
      next:
        "Wait for price to revisit the marked area and confirm bearish rejection. The zone is an area to assess, not an instruction to enter automatically.",
    };
  }

  return {
    action: "WAIT",
    setupType: "Wait for structure to clarify",
    marketCondition: "Mixed / unclear",
    recentHigh: level(swingHigh),
    recentLow: level(swingLow),
    rangeHigh: level(swingHigh),
    rangeLow: level(swingLow),
    paragraphs: [
      `Price has not shown a clear directional advantage in the latest candles. The recent high is ${fmt(level(swingHigh))} and the recent low is ${fmt(level(swingLow))}.`,
      "Wait for a clear close beyond one of these levels and then look for follow-through or a retest. Until then, the next direction is uncertain and an entry would be premature.",
    ],
    waitFor:
      "Wait for a candle close above the recent high or below the recent low, then look for a retest and a confirming candle in that direction.",
    buy: {
      entry: level(swingHigh),
      watchLow: level(swingHigh - pad * 0.25),
      watchHigh: level(swingHigh + pad * 0.25),
      zoneType: "Range resistance / breakout retest",
      stopLoss: level(swingLow),
      takeProfit: level(swingHigh + targetDistance),
      confirmation:
        "A candle closes above the recent high and a retest holds with a bullish close.",
      invalidation:
        "Price returns below the broken level and holds there.",
    },
    sell: {
      entry: level(swingLow),
      watchLow: level(swingLow - pad * 0.25),
      watchHigh: level(swingLow + pad * 0.25),
      zoneType: "Range support / breakdown retest",
      stopLoss: level(swingHigh),
      takeProfit: level(swingLow - targetDistance),
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


/*
 * If a proposed target is closer to entry than the stop is, move the target
 * so the potential reward is at least 1.5 times the stop distance.
 * This adjusts only the suggested levels; it does not guarantee the outcome.
 */
function enforceMinimumRewardRisk(analysis) {
  if (!analysis) return analysis;

  const adjusted = { ...analysis };

  ["buy", "sell"].forEach((side) => {
    const scenario = adjusted[side];
    if (!scenario) return;

    const entry = Number(scenario.entry);
    const stopLoss = Number(scenario.stopLoss);
    const takeProfit = Number(scenario.takeProfit);

    if (![entry, stopLoss, takeProfit].every(Number.isFinite)) return;

    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);

    if (risk > 0 && reward < risk * 1.5) {
      const direction = side === "buy" ? 1 : -1;
      const precision =
        Math.abs(entry) < 10 ? 5 : Math.abs(entry) < 1000 ? 3 : 2;

      adjusted[side] = {
        ...scenario,
        takeProfit: Number((entry + direction * risk * 1.5).toFixed(precision)),
      };
    }
  });

  return adjusted;
}


const PLAN_TERMINAL_STATUSES = new Set(["INVALIDATED", "TARGET REACHED", "AMBIGUOUS CANDLE"]);

function getPlanStorageKey(market, timeframe) {
  const provider = isCrypto(market) ? "binance" : "deriv";
  const symbol = String(market?.exchangeSymbol || market?.symbol || "").toUpperCase();
  return `nox.activePlan.v1:${provider}:${symbol}:${timeframe}`;
}

function readSavedPlan(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePlan(storageKey, plan) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(plan));
  } catch {
    // The active plan still works for this page session if storage is unavailable.
  }
}

function removeSavedPlan(storageKey) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage restrictions; analysis can continue in memory.
  }
}

function getCompletedCandles(rawCandles, timeframeSeconds) {
  const nowSeconds = Date.now() / 1000;
  return (rawCandles || [])
    .map(normalizeCandle)
    .filter((candle) =>
      Number.isFinite(candle.epoch) &&
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
      candle.epoch + timeframeSeconds <= nowSeconds
    )
    .sort((a, b) => a.epoch - b.epoch);
}

function createActivePlan(analysis, marketKey, completedCandles) {
  const direction = analysis.action;
  const side = direction.toLowerCase();
  const referenceCandle = completedCandles.at(-1);

  return {
    marketKey,
    direction,
    analysisSnapshot: analysis,
    status: "WAITING FOR ZONE",
    zoneTouched: false,
    zoneTouchEpoch: null,
    createdAt: Date.now(),
    referenceCandleEpoch: referenceCandle.epoch,
    lastEvaluatedEpoch: referenceCandle.epoch,
    statusMessage: `The ${direction} setup is locked. Its entry zone, stop-loss and target will not be recalculated on each analysis.`,
    originalEntry: analysis[side].entry,
    originalStopLoss: analysis[side].stopLoss,
    originalTakeProfit: analysis[side].takeProfit,
    events: [{
      epoch: referenceCandle.epoch,
      status: "PLAN CREATED",
      detail: `${direction} plan created with locked entry, stop-loss and target levels.`,
    }],
  };
}

function updateActivePlan(plan, completedCandles, timeframeSeconds) {
  if (!plan || PLAN_TERMINAL_STATUSES.has(plan.status)) return plan;

  const side = plan.direction.toLowerCase();
  const scenario = plan.analysisSnapshot?.[side];
  if (!scenario) return plan;

  const nextPlan = { ...plan };
  const newCandles = completedCandles.filter(
    (candle) => candle.epoch > Number(plan.lastEvaluatedEpoch || plan.referenceCandleEpoch)
  );

  for (const candle of newCandles) {
    // A stop-loss touch ends the original plan, even if the candle later closes back inside the zone.
    const stopHit = plan.direction === "BUY"
      ? candle.low <= Number(plan.originalStopLoss)
      : candle.high >= Number(plan.originalStopLoss);

    const targetHit = plan.direction === "BUY"
      ? candle.high >= Number(plan.originalTakeProfit)
      : candle.low <= Number(plan.originalTakeProfit);

    if (stopHit && targetHit) {
      nextPlan.status = "AMBIGUOUS CANDLE";
      nextPlan.statusMessage = "This candle's range crossed both the original stop and target. OHLC data cannot show which was reached first, so Nox will not label this outcome as a win or loss.";
      nextPlan.events = [...(nextPlan.events || []), { epoch: candle.epoch, status: "AMBIGUOUS CANDLE", detail: "Both stop and target were inside one candle's range; order of touches is unknown." }].slice(-12);
      nextPlan.lastEvaluatedEpoch = candle.epoch;
      break;
    }

    if (stopHit) {
      nextPlan.status = "INVALIDATED";
      nextPlan.statusMessage = `The original ${plan.direction} stop-loss level was reached. This setup is no longer active; reassess before creating another plan.`;
      nextPlan.events = [...(nextPlan.events || []), { epoch: candle.epoch, status: "INVALIDATED", detail: `Price reached the original stop-loss at ${fmt(plan.originalStopLoss)}.` }].slice(-12);
      nextPlan.lastEvaluatedEpoch = candle.epoch;
      break;
    }

    if (targetHit) {
      nextPlan.status = "TARGET REACHED";
      nextPlan.statusMessage = "The original target was reached. This plan is complete; reassess before mapping another setup.";
      nextPlan.events = [...(nextPlan.events || []), { epoch: candle.epoch, status: "TARGET REACHED", detail: `Price reached the original target at ${fmt(plan.originalTakeProfit)}.` }].slice(-12);
      nextPlan.lastEvaluatedEpoch = candle.epoch;
      break;
    }

    const touchedZone =
      candle.low <= Number(scenario.watchHigh) &&
      candle.high >= Number(scenario.watchLow);

    if (touchedZone) {
      if (!nextPlan.zoneTouched) {
        nextPlan.events = [...(nextPlan.events || []), { epoch: candle.epoch, status: "ZONE TOUCHED", detail: `Price first entered the original ${plan.direction} watch zone.` }].slice(-12);
      }
      nextPlan.zoneTouched = true;
      nextPlan.zoneTouchEpoch = candle.epoch;
    }

    const candleIsBullish = candle.close > candle.open;
    const candleIsBearish = candle.close < candle.open;
    const candleIndex = completedCandles.findIndex((item) => item.epoch === candle.epoch);
    const previous = candleIndex > 0 ? completedCandles[candleIndex - 1] : null;
    const movedWithDirection = previous
      ? plan.direction === "BUY"
        ? candle.close > previous.close
        : candle.close < previous.close
      : false;
    const recentZoneTouch =
      nextPlan.zoneTouched &&
      Number.isFinite(Number(nextPlan.zoneTouchEpoch)) &&
      candle.epoch - Number(nextPlan.zoneTouchEpoch) <= timeframeSeconds * 2;
    const confirmed = recentZoneTouch && movedWithDirection &&
      (plan.direction === "BUY" ? candleIsBullish : candleIsBearish);

    if (nextPlan.status !== "CONFIRMATION DETECTED" && confirmed) {
      nextPlan.status = "CONFIRMATION DETECTED";
      nextPlan.statusMessage = `A completed candle touched the original zone and closed in the ${plan.direction === "BUY" ? "bullish" : "bearish"} direction. This is a research signal only; NOX has not placed an order.`;
      nextPlan.events = [...(nextPlan.events || []), { epoch: candle.epoch, status: "CONFIRMATION DETECTED", detail: `A completed ${plan.direction === "BUY" ? "bullish" : "bearish"} candle confirmed the original zone.` }].slice(-12);
    } else if (nextPlan.status !== "CONFIRMATION DETECTED" && nextPlan.zoneTouched) {
      nextPlan.status = "WAITING FOR CONFIRMATION";
      nextPlan.statusMessage = `Price has reached the original ${plan.direction} zone. Keep the original levels and wait for a completed ${plan.direction === "BUY" ? "bullish" : "bearish"} candle to confirm; a touch alone is not an entry signal.`;
    }

    nextPlan.lastEvaluatedEpoch = candle.epoch;
  }

  if (nextPlan.status === "WAITING FOR ZONE") {
    nextPlan.statusMessage = `The original ${plan.direction} plan is still active. Price has not reached its watch zone yet; entry, stop-loss and target remain locked.`;
  }

  return nextPlan;
}

function presentActivePlan(plan, marketStory = null, memoryInfo = null) {
  const snapshot = plan.analysisSnapshot;
  const displayAction = plan.status === "CONFIRMATION DETECTED"
    ? `${plan.direction} NOW`
    : plan.status === "INVALIDATED" || plan.status === "TARGET REACHED"
      ? plan.status
      : plan.status;

  return {
    ...snapshot,
    action: plan.direction,
    planDirection: plan.direction,
    planStatus: plan.status,
    displayAction,
    statusMessage: plan.statusMessage,
    buy: plan.direction === "BUY" ? snapshot.buy : null,
    sell: plan.direction === "SELL" ? snapshot.sell : null,
    planCreatedAt: plan.createdAt,
    planEvents: plan.events || [],
    marketStory,
    memoryInfo,
  };
}

function CandleChart({ candles }) {
  const visible = candles.slice(-70);

  if (!visible.length) return null;

  const recentVisible = visible.slice(-20);
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

  // Build two soft price zones from the recent 20-candle extremes. These are
  // areas, not exact single-price levels; the zone thickness follows volatility.
  const averageRange =
    recentVisible.reduce((sum, candle) => sum + (candle.high - candle.low), 0) /
    Math.max(1, recentVisible.length);
  const zoneThickness = Math.max(averageRange * 0.42, span * 0.018);
  const resistanceHigh = Math.min(max, Math.max(...recentVisible.map((c) => c.high)));
  const resistanceLow = Math.max(min, resistanceHigh - zoneThickness);
  const supportLow = Math.max(min, Math.min(...recentVisible.map((c) => c.low)));
  const supportHigh = Math.min(max, supportLow + zoneThickness);

  const priceLabels = Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4;
    return { price: max - span * fraction, y: top + plotHeight * fraction };
  });



  return (
    <div className="chart-wrap">
      <div className="chart-topline">
        <span>PRICE HISTORY</span>
        <span>{visible.length} candles · {formatCandleTime(visible.at(-1)?.epoch)}</span>
      </div>

      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Historical candlestick chart with full-width support and resistance zones behind the candles"
      >
        <defs>
          <linearGradient id="resistanceZoneFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a72a36" stopOpacity="0.10" />
            <stop offset="55%" stopColor="#e34f60" stopOpacity="0.19" />
            <stop offset="100%" stopColor="#a72a36" stopOpacity="0.10" />
          </linearGradient>
          <linearGradient id="supportZoneFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#008f83" stopOpacity="0.10" />
            <stop offset="55%" stopColor="#31c99a" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#008f83" stopOpacity="0.10" />
          </linearGradient>
        </defs>

        {/* Zones are deliberately rendered first so all candles sit above them. */}
        {resistanceHigh > resistanceLow && (
          <g className="sr-zone resistance-zone">
            <rect
              x={left}
              y={y(resistanceHigh)}
              width={plotWidth}
              height={Math.max(2, y(resistanceLow) - y(resistanceHigh))}
              fill="url(#resistanceZoneFill)"
            />
            <line x1={left} x2={left + plotWidth} y1={y(resistanceHigh)} y2={y(resistanceHigh)} className="sr-zone-edge resistance" />
            <line x1={left} x2={left + plotWidth} y1={y(resistanceLow)} y2={y(resistanceLow)} className="sr-zone-edge resistance" />
          </g>
        )}
        {supportHigh > supportLow && (
          <g className="sr-zone support-zone">
            <rect
              x={left}
              y={y(supportHigh)}
              width={plotWidth}
              height={Math.max(2, y(supportLow) - y(supportHigh))}
              fill="url(#supportZoneFill)"
            />
            <line x1={left} x2={left + plotWidth} y1={y(supportHigh)} y2={y(supportHigh)} className="sr-zone-edge support" />
            <line x1={left} x2={left + plotWidth} y1={y(supportLow)} y2={y(supportLow)} className="sr-zone-edge support" />
          </g>
        )}

        {/* Candlesticks render after the zones, keeping their bodies and wicks clear. */}
        {visible.map((c, i) => {
          const x = left + i * step + step / 2;
          const up = c.close >= c.open;
          const bodyY = y(Math.max(c.open, c.close));
          const bodyHeight = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
          return (
            <g key={`${c.epoch ?? i}-${i}`}>
              <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} className={up ? "candle-wick up" : "candle-wick down"} />
              <rect x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx="1" className={up ? "candle-body up" : "candle-body down"} />
            </g>
          );
        })}



        {priceLabels.map(({ price, y: labelY }, index) => (
          <text
            key={`price-${index}`}
            x={width - right + 4}
            y={labelY}
            textAnchor="start"
            dominantBaseline={index === 0 ? "hanging" : index === priceLabels.length - 1 ? "auto" : "middle"}
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
        <p>WATCH RETRACEMENT ZONE</p>
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
        const endpoint = `${API_BASE_URL}/api/binance/markets`;
        const response = await fetch(endpoint);
        const contentType = response.headers.get("content-type") || "";

        if (!contentType.toLowerCase().includes("application/json")) {
          const bodyPreview = (await response.text())
            .replace(/\s+/g, " ")
            .slice(0, 100);

          throw new Error(
            `Expected JSON from ${endpoint} but received HTML or another content type. Check your backend URL and deployment. Response: ${bodyPreview}`
          );
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Binance market list request failed.");
        }

        if (!Array.isArray(data.markets)) {
          throw new Error(
            data.error || "Binance response did not contain a markets array."
          );
        }

        const markets = data.markets.map((coin) => {
          const exchangeSymbol = String(
            coin.exchangeSymbol || coin.id || coin.symbol || ""
          ).toUpperCase();
          const rawBaseAsset = String(
            coin.baseAsset || coin.symbol || exchangeSymbol
          ).toUpperCase();
          const baseAsset = rawBaseAsset.endsWith("USDT")
            ? rawBaseAsset.slice(0, -4)
            : rawBaseAsset;
          const displayName = coin.name || baseAsset;

          return {
            label: `${displayName} (${baseAsset})`,
            category: "Crypto · Binance spot data",
            symbol: exchangeSymbol,
            provider: "binance",
            baseAsset,
            exchangeSymbol,
            currentPrice: coin.currentPrice,
            marketCapRank: coin.marketCapRank,
          };
        });

        if (!cancelled) {
          setCryptoMarkets(markets);
          setCryptoStatus(`${markets.length} crypto markets available`);
        }
      } catch (err) {
        if (!cancelled) {
          setCryptoStatus(
            `Crypto list unavailable: ${err?.message || "unknown error"}`
          );
          console.error("Binance market list unavailable:", err);
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

    let client = null;

    try {
      let data;

      if (isCrypto(market)) {
        setConnection("Requesting Binance historical crypto candles…");

        const params = new URLSearchParams({
          provider: "binance",
          symbol: String(
            market.exchangeSymbol ||
              `${String(market.baseAsset || "").toUpperCase()}USDT`
          ).toUpperCase(),
          timeframe:
            TIMEFRAMES.find((tf) => tf.value === timeframe)?.apiValue || "15m",
          limit: "300",
        });

        const response = await fetch(
          `${API_BASE_URL}/api/candles?${params.toString()}`
        );

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "Backend returned non-JSON candle data. Confirm server.js is running and the backend URL is correct."
          );
        }

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              "Could not retrieve Binance crypto candles. This crypto may not have a Binance USDT spot pair."
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
        data = await getCandles(client, market.symbol, timeframe, 300);

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

      // Merge the newest completed candles with browser memory. Repeated analysis
      // must add context, not discard the chart's previously observed history.
      const storageKey = getPlanStorageKey(market, timeframe);
      const memoryKey = getChartMemoryKey(market, timeframe);
      const oldMemory = readChartMemory(memoryKey);
      const completedFetched = getCompletedCandles(data, timeframe);
      const mergedCandles = mergeCandleHistory(oldMemory.candles, completedFetched);
      if (mergedCandles.length < 5) {
        throw new Error("There are not enough completed candles yet to analyze this timeframe.");
      }

      const marketStory = buildMarketStory(mergedCandles, oldMemory.observations.at(-1) || null);
      const updatedMemory = recordChartObservation(
        { candles: mergedCandles, observations: oldMemory.observations },
        marketStory
      );
      try {
        window.localStorage.setItem(memoryKey, JSON.stringify(updatedMemory));
      } catch {
        // Analysis still works when browser storage is disabled or full.
      }
      const memoryInfo = {
        candleCount: mergedCandles.length,
        observationCount: updatedMemory.observations.length,
        observations: updatedMemory.observations.slice(-6).reverse(),
      };
      setCandles(mergedCandles);

      const savedPlan = readSavedPlan(storageKey);
      const savedPlanIsUsable = savedPlan &&
        savedPlan.marketKey === storageKey &&
        ["BUY", "SELL"].includes(savedPlan.direction);

      if (savedPlanIsUsable) {
        // Keep the original setup and levels. Terminal outcomes remain visible
        // until the user deliberately starts a fresh analysis.
        const updatedPlan = PLAN_TERMINAL_STATUSES.has(savedPlan.status)
          ? savedPlan
          : updateActivePlan(savedPlan, mergedCandles, timeframe);
        savePlan(storageKey, updatedPlan);
        setAnalysis(presentActivePlan(updatedPlan, marketStory, memoryInfo));
      } else {
        const freshAnalysis = enforceMinimumRewardRisk(analyzeCandles(mergedCandles));
        freshAnalysis.marketStory = marketStory;
        freshAnalysis.memoryInfo = memoryInfo;
        const side = freshAnalysis.action.toLowerCase();
        const hasDirectionalSetup = ["BUY", "SELL"].includes(freshAnalysis.action) && Boolean(freshAnalysis[side]);

        if (hasDirectionalSetup) {
          const newPlan = createActivePlan(freshAnalysis, storageKey, mergedCandles);
          savePlan(storageKey, newPlan);
          setAnalysis(presentActivePlan(newPlan, marketStory, memoryInfo));
        } else {
          removeSavedPlan(storageKey);
          setAnalysis(freshAnalysis);
        }
      }

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
              connection.includes("Data received") ||
              connection.includes("Connected")
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
            <span className="chart-live-tag">LOCAL + LIVE HISTORY</span>
          </div>

          <CandleChart candles={candles} />
        </section>
      )}

      {analysis?.marketStory && !loading && (
        <section className="market-story-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CONTEXT · MEMORY · SCENARIOS</p>
              <h2>Market story</h2>
              <p>What price did, what it is doing now, and what would confirm the next path.</p>
            </div>
            <span className="chart-live-tag">{analysis.marketStory.candleCount} BARS REMEMBERED</span>
          </div>

          <div className="market-story-grid">
            <article className="market-story-card">
              <span className="field-label">WHAT HAPPENED</span>
              <p>{analysis.marketStory.history}</p>
              <small>Wider high/low: {fmt(analysis.marketStory.widerHigh)} / {fmt(analysis.marketStory.widerLow)}</small>
            </article>
            <article className="market-story-card">
              <span className="field-label">WHAT IS HAPPENING</span>
              <strong>{analysis.marketStory.presentBias}</strong>
              <p>{analysis.marketStory.current}</p>
              <small>Recent structure: {analysis.marketStory.structure}</small>
              <p className="market-story-change">{analysis.marketStory.changeSinceLastCheck}</p>
            </article>
            <article className="market-story-card anticipation-card">
              <span className="field-label">WHAT COULD HAPPEN NEXT</span>
              {analysis.marketStory.anticipation.map((scenario) => (
                <div className="anticipation-item" key={scenario.title}>
                  <strong>{scenario.title}</strong>
                  <p>{scenario.detail}</p>
                </div>
              ))}
              <small>Conditional scenarios, not certainty or probability estimates.</small>
            </article>
          </div>

          <div className="memory-panel">
            <div className="memory-panel-heading">
              <div>
                <span className="field-label">NOX CHART MEMORY</span>
                <p>Saved locally in this browser for this market and timeframe.</p>
              </div>
              <span className="memory-count">{analysis.memoryInfo?.observationCount || 0} observations</span>
            </div>
            {analysis.planEvents?.length > 0 && (
              <div className="memory-events">
                <h4>ACTIVE PLAN TIMELINE</h4>
                {analysis.planEvents.slice(-5).reverse().map((event, index) => (
                  <div className="memory-event" key={`${event.epoch}-${event.status}-${index}`}>
                    <span>{event.status}</span>
                    <p>{event.detail}</p>
                    <small>{formatCandleTime(event.epoch)}</small>
                  </div>
                ))}
              </div>
            )}
            {analysis.memoryInfo?.observations?.length > 0 && (
              <div className="memory-events">
                <h4>RECENT MARKET OBSERVATIONS</h4>
                {analysis.memoryInfo.observations.slice(0, 4).map((observation) => (
                  <div className="memory-event" key={observation.epoch}>
                    <span>{observation.structure}</span>
                    <p>Close {fmt(observation.close)} · {observation.presentBias} · volatility {observation.volatility.toLowerCase()} · range position {observation.rangePosition}%</p>
                    <small>{formatCandleTime(observation.epoch)}</small>
                  </div>
                ))}
              </div>
            )}
            {analysis.planDirection && (
              <button
                className="memory-reset-button"
                type="button"
                onClick={() => {
                  removeSavedPlan(getPlanStorageKey(market, timeframe));
                  setAnalysis(null);
                  runAnalysis();
                }}
                disabled={loading}
              >
                REASSESS MARKET &amp; CREATE A NEW PLAN
              </button>
            )}
          </div>
        </section>
      )}

      {analysis && !loading && (
        <section className="report-section">
          <div className="report-header">
            <div>
              <p className="eyebrow">MARKET REPORT</p>
              <h2>What price is showing</h2>
            </div>
            <span className={`action-badge ${analysis.planStatus === "CONFIRMATION DETECTED" ? analysis.planDirection.toLowerCase() : analysis.planStatus ? "wait" : analysis.action.toLowerCase()}`}>
              {analysis.displayAction || analysis.action}
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
                <h3>{analysis.displayAction || analysis.action}</h3>
              </div>

              <div className="setup-type">
                <span className="field-label">SETUP TYPE</span>
                <strong>{analysis.setupType}</strong>
              </div>
            </div>

            {(analysis.action === "WAIT" || analysis.planDirection) && (
              <div className="wait-message">
                <h4>{analysis.planDirection ? "PLAN STATUS" : "WHAT TO WAIT FOR"}</h4>
                <p>{analysis.statusMessage || analysis.waitFor}</p>
              </div>
            )}

            {analysis.planDirection ? (
              <div className="scenario-grid scenario-grid-single">
                <ScenarioCard
                  side={analysis.planDirection}
                  scenario={analysis[analysis.planDirection.toLowerCase()]}
                />
              </div>
            ) : analysis.action === "WAIT" ? (
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
            Nox stores up to 600 completed candles per market/timeframe in this
            browser and requests up to 300 fresh candles when available. Memory
            is local to this browser and is not shared across devices. Swing
            zones and structure labels are rule-based estimates, not verified
            institutional order blocks. Anticipations are conditional scenarios,
            not guaranteed predictions. If one candle spans both stop and target,
            OHLC history cannot reveal which was reached first.
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