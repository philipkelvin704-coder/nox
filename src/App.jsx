import { useEffect, useMemo, useRef, useState } from "react";
import { connectToDeriv, getCandles, formatCandleTime } from "./deriv";
import "./App.css";


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

async function copyToClipboard(value) {
  const text = String(value ?? "");
  if (!text || text === "—") return false;

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Continue to the compatibility fallback below.
  }

  let field;
  try {
    field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    field.style.top = "0";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    field?.remove();
  }
}

function formatClipboardNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "—";
}

function CopyPrice({ value, size = "", copyFirst = false }) {
  const [copied, setCopied] = useState(false);
  const displayValue = fmt(value);
  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const success = await copyToClipboard(formatClipboardNumber(value));
    setCopied(success);
    if (success) window.setTimeout(() => setCopied(false), 1200);
  };
  const copyButton = (
    <button
      type="button"
      className={`copy-price-button${copied ? " is-copied" : ""}`}
      onClick={handleCopy}
      aria-label={`Copy price ${displayValue}`}
      title={copied ? "Copied" : "Copy price"}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );

  return (
    <span className={`copy-price${size ? ` ${size}` : ""}${copyFirst ? " copy-first" : ""}`}>
      {copyFirst && copyButton}
      <strong>{displayValue}</strong>
      {!copyFirst && copyButton}
    </span>
  );
}

function CopyBar({ value }) {
  const [copied, setCopied] = useState(false);
  const displayValue = Number.isFinite(Number(value)) ? String(Number(value)) : "—";
  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const success = await copyToClipboard(displayValue);
    setCopied(success);
    if (success) window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <span className="trendline-bar-coordinate">
      <button
        type="button"
        className={`trendline-copy-button${copied ? " is-copied" : ""}`}
        onClick={handleCopy}
        aria-label={`Copy swing bar ${displayValue}`}
        title={copied ? "Copied" : "Copy swing bar"}
      >
        {copied ? "✓" : "⧉"}
      </button>
      <strong>{displayValue}</strong>
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
 * Support and resistance retain the original swing-candle logic: resistance
 * uses the swing high and candle body; support uses the swing low and body.
 * One unified set of horizontal support and resistance swing areas.
 */
function findSupportResistanceLevels(candles, avgBody, pad, lookback = 180) {
  const zones = [];
  const start = Math.max(0, candles.length - lookback);
  const recent = candles.slice(start);
  for (let i = 2; i < recent.length - 2; i += 1) {
    const candle = recent[i];
    const isSwingHigh = candle.high >= recent[i - 1].high &&
      candle.high >= recent[i - 2].high &&
      candle.high >= recent[i + 1].high &&
      candle.high >= recent[i + 2].high;
    const isSwingLow = candle.low <= recent[i - 1].low &&
      candle.low <= recent[i - 2].low &&
      candle.low <= recent[i + 1].low &&
      candle.low <= recent[i + 2].low;
    if (isSwingHigh) zones.push({
      type: "Resistance", low: Math.min(candle.open, candle.close),
      high: candle.high, index: start + i, source: "swing",
    });
    if (isSwingLow) zones.push({
      type: "Support", low: candle.low,
      high: Math.max(candle.open, candle.close), index: start + i, source: "swing",
    });
  }
  return zones.map((zone) => ({
    ...zone, width: zone.high - zone.low,
    age: candles.length - 1 - zone.index,
  })).filter((zone) => zone.width <= Math.max(pad * 8, avgBody * 5));
}

function selectPriceLevel(zones, direction, currentPrice, pad) {
  const candidates = zones.filter((zone) => direction === "SELL"
    ? zone.type === "Resistance" && zone.high > currentPrice + pad * 0.1
    : zone.type === "Support" && zone.low < currentPrice - pad * 0.1);
  if (!candidates.length) return null;
  return candidates.map((zone) => {
    const distance = direction === "SELL"
      ? Math.max(0, zone.low - currentPrice)
      : Math.max(0, currentPrice - zone.high);
    return { ...zone, price: (zone.low + zone.high) / 2, score: distance + zone.age * pad * 0.002 };
  }).sort((a, b) => a.score - b.score)[0];
}

const MAX_MEMORY_CANDLES = 600;
const MAX_MEMORY_OBSERVATIONS = 30;
const SESSION_STORAGE_KEY = "nox.session.v1";

function readSavedSession() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    return saved;
  } catch {
    return null;
  }
}

function saveSession(market, timeframe) {
  if (!market?.symbol || !Number.isFinite(Number(timeframe))) return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      provider: "deriv",
      symbol: String(market.symbol).trim(),
      timeframe: Number(timeframe),
      savedAt: Date.now(),
    }));
  } catch {
    // Session resume is best-effort when browser storage is unavailable.
  }
}

function getChartMemoryKey(market, timeframe) {
  const symbol = String(market?.symbol || "").trim();
  return `nox.chartMemory.v2:deriv:${symbol}:${timeframe}`;
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

/* One confirmed-wick pivot engine feeds structure and trendline anchors. */
function detectConfirmedSwings(candles, lookback = 180) {
  const sampleStart = Math.max(0, candles.length - lookback);
  const sample = candles.slice(sampleStart);
  const chartStartIndex = Math.max(0, candles.length - 300);
  const highs = [];
  const lows = [];
  const leftBars = 2;
  const rightBars = 2;

  for (let i = leftBars; i < sample.length - rightBars; i += 1) {
    const candle = sample[i];
    const left = sample.slice(i - leftBars, i);
    const right = sample.slice(i + 1, i + rightBars + 1);
    const isSwingHigh = left.every((bar) => candle.high >= bar.high) &&
      right.every((bar) => candle.high > bar.high);
    const isSwingLow = left.every((bar) => candle.low <= bar.low) &&
      right.every((bar) => candle.low < bar.low);
    const candleIndex = sampleStart + i;
    const point = {
      index: candleIndex,
      candleIndex,
      bar: candleIndex - chartStartIndex,
      epoch: Number(candle.epoch),
    };

    if (isSwingHigh) highs.push({ ...point, price: candle.high });
    if (isSwingLow) lows.push({ ...point, price: candle.low });
  }

  return { highs, lows, chartStartIndex };
}

/* Structure, BUY/SELL bias and trendline anchors share the same confirmed pivots. */
function detectStructureTrend(candles, lookback = 180) {
  const { highs, lows } = detectConfirmedSwings(candles, lookback);
  const lastTwoHighs = highs.slice(-2);
  const lastTwoLows = lows.slice(-2);
  let direction = "NEUTRAL";
  let description = "Insufficient confirmed swing structure";

  if (lastTwoHighs.length === 2 && lastTwoLows.length === 2) {
    const higherHigh = lastTwoHighs[1].price > lastTwoHighs[0].price;
    const higherLow = lastTwoLows[1].price > lastTwoLows[0].price;
    const lowerHigh = lastTwoHighs[1].price < lastTwoHighs[0].price;
    const lowerLow = lastTwoLows[1].price < lastTwoLows[0].price;

    if (higherHigh && higherLow) {
      direction = "BULLISH";
      description = "Higher highs and higher lows";
    } else if (lowerHigh && lowerLow) {
      direction = "BEARISH";
      description = "Lower highs and lower lows";
    } else {
      description = "Mixed swing structure; no confirmed trend";
    }
  }

  return {
    direction,
    description,
    highs,
    lows,
    swingHigh: lastTwoHighs.at(-1)?.price ?? null,
    swingLow: lastTwoLows.at(-1)?.price ?? null,
  };
}

function buildSwingTrendLines(trend, scope, tolerance = 0, candles = []) {
  const lines = [];
  if (trend?.direction !== "BULLISH" && trend?.direction !== "BEARISH") return lines;

  const bullish = trend.direction === "BULLISH";
  const points = (bullish ? (trend.lows || []) : (trend.highs || [])).filter((point) =>
    Number.isFinite(point.price) && Number.isFinite(point.candleIndex) &&
    Number.isFinite(point.epoch)
  );
  if (points.length < 2) return lines;

  const recentCandles = candles.slice(-20);
  const trueRanges = recentCandles.map((candle, index) => {
    const previousClose = index ? recentCandles[index - 1].close : candle.open;
    return Math.max(candle.high - candle.low,
      Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  }).filter((value) => Number.isFinite(value) && value > 0);
  const averageTrueRange = trueRanges.length
    ? trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length
    : 0;
  const wickTolerance = Math.max(Number.isFinite(tolerance) ? tolerance : 0, averageTrueRange * 0.10);
  const minDisplacement = Math.max(averageTrueRange * 0.35, Math.abs(candles.at(-1)?.close || 0) * 0.00003);
  let best = null;

  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const first = points[i];
      const second = points[j];
      const distance = second.candleIndex - first.candleIndex;
      if (distance < 6) continue;

      const displacement = second.price - first.price;
      if (bullish ? displacement <= minDisplacement : displacement >= -minDisplacement) continue;
      const slope = displacement / distance;
      const lineAt = (index) => first.price + slope * (index - first.candleIndex);
      let breached = false;
      let touchCount = 0;
      let totalViolation = 0;

      // Check all candles from the first anchor through the latest completed candle.
      for (let candleIndex = first.candleIndex; candleIndex < candles.length; candleIndex += 1) {
        const candle = candles[candleIndex];
        if (!candle) continue;
        const projected = lineAt(candleIndex);
        const wick = bullish ? candle.low : candle.high;
        const violation = bullish ? projected - wick : wick - projected;

        if (violation > wickTolerance) {
          breached = true;
          totalViolation += violation;
          break;
        }
        if (candleIndex <= second.candleIndex && Math.abs(wick - projected) <= Math.max(wickTolerance, averageTrueRange * 0.16)) {
          touchCount += 1;
        }
      }
      if (breached || touchCount < 2) continue;

      const score = second.candleIndex * 1000 + Math.min(distance, 120) * 2 + Math.min(touchCount, 8) * 15 - totalViolation * 100;
      if (!best || score > best.score) best = { first, second, score, touchCount };
    }
  }

  if (!best) return lines;
  lines.push({
    id: `${scope}-${bullish ? "bullish" : "bearish"}-trendline`,
    scope,
    direction: trend.direction,
    kind: bullish ? "RISING SUPPORT" : "FALLING RESISTANCE",
    color: bullish ? "#008f83" : "#aa0000",
    first: { ...best.first },
    second: { ...best.second },
    touches: best.touchCount,
  });
  return lines;
}

function projectTrendLinePrice(line, epoch) {
  const firstEpoch = Number(line?.first?.epoch);
  const secondEpoch = Number(line?.second?.epoch);
  if (!Number.isFinite(firstEpoch) || !Number.isFinite(secondEpoch) || secondEpoch === firstEpoch) return null;
  const slope = (line.second.price - line.first.price) / (secondEpoch - firstEpoch);
  const projected = line.first.price + slope * (Number(epoch) - firstEpoch);
  return Number.isFinite(projected) ? projected : null;
}

function selectTrendLineReference(lines, direction, currentPrice, epoch, pad) {
  const expectedDirection = direction === "BUY" ? "BULLISH" : "BEARISH";
  const candidates = (lines || [])
    .filter((line) => line.direction === expectedDirection)
    .map((line) => ({ ...line, projectedPrice: projectTrendLinePrice(line, epoch) }))
    .filter((line) => Number.isFinite(line.projectedPrice))
    .filter((line) => direction === "BUY"
      ? line.projectedPrice < currentPrice
      : line.projectedPrice > currentPrice)
    .sort((a, b) => Math.abs(a.projectedPrice - currentPrice) - Math.abs(b.projectedPrice - currentPrice));

  const selected = candidates[0];
  if (!selected) return null;
  return {
    ...selected,
    price: selected.projectedPrice,
    low: selected.projectedPrice - pad * 0.35,
    high: selected.projectedPrice + pad * 0.35,
    distance: Math.abs(selected.projectedPrice - currentPrice),
    label: `Major ${selected.kind.toLowerCase()}`,
  };
}

function analyzeCandles(rawCandles, timeframeSeconds = 300) {
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

  const pad = Math.max(
    avgBody * 1.2,
    range * 0.08,
    Math.abs(last.close) * 0.0005
  );

  const story = buildMarketStory(candles);
  const majorTrend = detectStructureTrend(candles, 180);
  const detectedMajorTrendLines = buildSwingTrendLines(majorTrend, "MAJOR", pad * 0.2, candles);

  const trendLines = detectedMajorTrendLines.filter((line) =>
    majorTrend.direction === "BULLISH"
      ? line.direction === "BULLISH"
      : majorTrend.direction === "BEARISH"
        ? line.direction === "BEARISH"
        : false
  ).slice(0, 1);

  const shortMomentum = last.close - (candles.at(-5)?.close ?? firstClose);

  const bullishStructure =
    majorTrend.direction === "BULLISH" &&
    Number.isFinite(majorTrend.swingLow) &&
    last.close > majorTrend.swingLow;

  const bearishStructure =
    majorTrend.direction === "BEARISH" &&
    Number.isFinite(majorTrend.swingHigh) &&
    last.close < majorTrend.swingHigh;

  const precision =
    Math.abs(last.close) < 10
      ? 5
      : Math.abs(last.close) < 1000
        ? 3
        : 2;

  const level = (n) => Number(n.toFixed(precision));

  const targetDistance = Math.max(range * 0.45, pad * 1.5);
  const priceLevels = findSupportResistanceLevels(candles, avgBody, pad, 180);
  const support = selectPriceLevel(priceLevels, "BUY", last.close, pad);
  const resistance = selectPriceLevel(priceLevels, "SELL", last.close, pad);
  const bullishTrendLine = selectTrendLineReference(trendLines, "BUY", last.close, last.epoch, pad);
  const bearishTrendLine = selectTrendLineReference(trendLines, "SELL", last.close, last.epoch, pad);
  const bullish = bullishStructure;
  const bearish = bearishStructure;

  const isConsolidating =
    majorTrend.direction === "NEUTRAL" &&
    !bullish &&
    !bearish &&
    (swingHigh - swingLow) / Math.max(Math.abs(last.close), 1e-9) < 0.012 &&
    trendPercent < 0.008;

  const chartLevels = [
    support && { id: "support", label: "SUPPORT", type: "support", low: level(support.low), high: level(support.high), price: level(support.price) },
    resistance && { id: "resistance", label: "RESISTANCE", type: "resistance", low: level(resistance.low), high: level(resistance.high), price: level(resistance.price) },
  ].filter(Boolean);

  const trendContext = {
    major: majorTrend.direction,
    majorDescription: majorTrend.description,
    trendLineReading: trendLines.map((line) => ({
      label: line.kind === "RISING SUPPORT" ? "MAJOR RISING SUPPORT" : "MAJOR FALLING RESISTANCE",
      projectedPrice: projectTrendLinePrice(line, last.epoch),
    })),
    majorSwingPoints: { highs: majorTrend.highs, lows: majorTrend.lows },
    trendLines: trendLines.map((line) => ({
      ...line,
      projectedPrice: projectTrendLinePrice(line, last.epoch),
      first: { ...line.first, price: level(line.first.price) },
      second: { ...line.second, price: level(line.second.price) },
    })),
    bullishTrendLine: bullishTrendLine ? { scope: bullishTrendLine.scope, kind: bullishTrendLine.kind, price: level(bullishTrendLine.price), low: level(bullishTrendLine.low), high: level(bullishTrendLine.high), label: bullishTrendLine.label } : null,
    bearishTrendLine: bearishTrendLine ? { scope: bearishTrendLine.scope, kind: bearishTrendLine.kind, price: level(bearishTrendLine.price), low: level(bearishTrendLine.low), high: level(bearishTrendLine.high), label: bearishTrendLine.label } : null,
    support: support ? { price: level(support.price), low: level(support.low), high: level(support.high), score: support.score, quality: support.quality, touches: support.touches } : null,
    resistance: resistance ? { price: level(resistance.price), low: level(resistance.low), high: level(resistance.high), score: resistance.score, quality: resistance.quality, touches: resistance.touches } : null,
  };

  if (isConsolidating) {
    return {
      action: "WAIT",
      setupType: "Breakout and retest",
      marketCondition: "Consolidation",
      chartLevels,
      trendContext,
      recentHigh: level(swingHigh),
      recentLow: level(swingLow),
      rangeHigh: level(swingHigh),
      rangeLow: level(swingLow),
      paragraphs: [
        `Price has been moving sideways between ${fmt(level(swingLow))} and ${fmt(level(swingHigh))}. Neither side has clearly taken control, so entering in the middle of this range would mean guessing.`,
        `${trendLines.length ? "Major swing trend-line references are available for the current structure." : "No valid major trend line is confirmed from the available swing points."} Support and resistance remain horizontal swing references.`,
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
    const selectedLevel = bullishTrendLine || support;
    const watchLow = selectedLevel ? level(selectedLevel.low) : level(Math.max(swingLow, last.close - pad));
    const watchHigh = selectedLevel ? level(selectedLevel.high) : level(Math.max(watchLow + pad * 0.25, last.close - pad * 0.25));
    const entry = level((watchLow + watchHigh) / 2);
    const stop = level(Math.min(swingLow, majorTrend.swingLow ?? swingLow) - pad * 0.12);
    const opposingResistance = resistance && resistance.price > entry ? resistance : null;
    const tp = opposingResistance ? level(opposingResistance.price) : level(Math.max(swingHigh, entry + targetDistance));
    const zoneType = bullishTrendLine ? "Major rising swing trend line" : support ? "Horizontal support area" : "Recent structural support area";
    const continuationMagnet = tp;

    return {
      action: "BUY",
      setupType: "Bullish continuation · wait for pullback",
      marketCondition: "Bullish trend",
      chartLevels,
      trendContext: { ...trendContext, continuationMagnet },
      recentHigh: level(swingHigh), recentLow: level(swingLow), rangeHigh: level(swingHigh), rangeLow: level(swingLow),
      paragraphs: [
        `Recent candles show buyers pushing price upward. The latest close is ${fmt(level(last.close))}, while the recent high and low are ${fmt(level(swingHigh))} and ${fmt(level(swingLow))}. Major swing structure is ${majorTrend.description.toLowerCase()}.`,
        `${bullishTrendLine ? "A valid major rising support trend line is confirmed. " : "No valid major rising trend line is confirmed from the swing lows. "}The next horizontal resistance reference is ${fmt(continuationMagnet)}.`,
      ],
      waitFor: `Watch ${zoneType.toLowerCase()} between ${fmt(watchLow)} and ${fmt(watchHigh)}. Wait for a bullish candle to close after price tests the area. If price closes decisively below support, stand aside.`,
      buy: {
        entry, watchLow, watchHigh, zoneType, stopLoss: stop, takeProfit: tp,
        confirmation: `Price returns to the ${zoneType.toLowerCase()} reference, rejects lower prices, and a completed bullish candle closes upward.`,
        invalidation: "Price closes decisively below the selected support and fails to reclaim it. Cancel the buy idea.",
      },
      sell: null,
      invalidates: "A decisive move below the recent structural swing low weakens or invalidates the bullish structure.",
      next: "Wait for price to revisit support and confirm bullish rejection. Do not enter merely because price touches the level.",
    };
  }

  if (bearish) {
    const selectedLevel = bearishTrendLine || resistance;
    const watchLow = selectedLevel ? level(selectedLevel.low) : level(Math.min(swingHigh, last.close + pad * 0.25));
    const watchHigh = selectedLevel ? level(selectedLevel.high) : level(Math.max(watchLow + pad * 0.25, last.close + pad));
    const entry = level((watchLow + watchHigh) / 2);
    const stop = level(Math.max(swingHigh, majorTrend.swingHigh ?? swingHigh) + pad * 0.12);
    const opposingSupport = support && support.price < entry ? support : null;
    const tp = opposingSupport ? level(opposingSupport.price) : level(Math.min(swingLow, entry - targetDistance));
    const zoneType = bearishTrendLine ? "Major falling swing trend line" : resistance ? "Horizontal resistance area" : "Recent structural resistance area";
    const continuationMagnet = tp;

    return {
      action: "SELL",
      setupType: "Bearish continuation · wait for pullback",
      marketCondition: "Bearish trend",
      chartLevels,
      trendContext: { ...trendContext, continuationMagnet },
      recentHigh: level(swingHigh), recentLow: level(swingLow), rangeHigh: level(swingHigh), rangeLow: level(swingLow),
      paragraphs: [
        `Recent candles show sellers pushing price downward. The latest close is ${fmt(level(last.close))}, while the recent high and low are ${fmt(level(swingHigh))} and ${fmt(level(swingLow))}. Major swing structure is ${majorTrend.description.toLowerCase()}.`,
        `${bearishTrendLine ? "A valid major falling resistance trend line is confirmed. " : "No valid major falling trend line is confirmed from the swing highs. "}The next horizontal support reference is ${fmt(continuationMagnet)}.`,
      ],
      waitFor: `Watch ${zoneType.toLowerCase()} between ${fmt(watchLow)} and ${fmt(watchHigh)}. Wait for a bearish candle to close after price tests the area. If price closes decisively above resistance, stand aside.`,
      buy: null,
      sell: {
        entry, watchLow, watchHigh, zoneType, stopLoss: stop, takeProfit: tp,
        confirmation: `Price returns to the ${zoneType.toLowerCase()} reference, rejects higher prices, and a completed bearish candle closes downward.`,
        invalidation: "Price closes decisively above the selected resistance and holds above it. Cancel the sell idea.",
      },
      invalidates: "A decisive move above the recent structural swing high weakens or invalidates the bearish structure.",
      next: "Wait for price to revisit resistance and confirm bearish rejection. Do not enter merely because price touches the level.",
    };
  }

  return {
    action: "WAIT",
    setupType: "Wait for structure to clarify",
    marketCondition: "Mixed / unclear",
    chartLevels,
    trendContext,
    recentHigh: level(swingHigh),
    recentLow: level(swingLow),
    rangeHigh: level(swingHigh),
    rangeLow: level(swingLow),
    paragraphs: [
      `Price has not shown a clear directional advantage in the latest candles. The recent high is ${fmt(level(swingHigh))} and the recent low is ${fmt(level(swingLow))}. Major swing structure is ${majorTrend.description.toLowerCase()}.`,
      `Assess the candle close around horizontal support, resistance and the major trend line. A wick or touch alone does not confirm a break or rejection.`,
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
  const symbol = String(market?.symbol || "").trim();
  return `nox.activePlan.v3:deriv:${symbol}:${timeframe}`;
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

function getCandleCloseEpoch(epoch, timeframeSeconds) {
  if (timeframeSeconds === 2592000) {
    const nextMonth = new Date(Number(epoch) * 1000);
    nextMonth.setUTCDate(1);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCHours(0, 0, 0, 0);
    return nextMonth.getTime() / 1000;
  }
  return Number(epoch) + timeframeSeconds;
}

function getCandleDurationSeconds(epoch, timeframeSeconds) {
  return getCandleCloseEpoch(epoch, timeframeSeconds) - Number(epoch);
}

function getCompletedCandles(rawCandles, timeframeSeconds) {
  const nowSeconds = Date.now() / 1000;
  return (rawCandles || [])
    .map(normalizeCandle)
    .filter((candle) =>
      Number.isFinite(candle.epoch) &&
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
      getCandleCloseEpoch(candle.epoch, timeframeSeconds) <= nowSeconds
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
      candle.epoch - Number(nextPlan.zoneTouchEpoch) <= getCandleDurationSeconds(Number(nextPlan.zoneTouchEpoch), timeframeSeconds) * 2;
    const confirmed = recentZoneTouch && movedWithDirection &&
      (plan.direction === "BUY" ? candleIsBullish : candleIsBearish);

    if (nextPlan.status !== "CONFIRMATION DETECTED" && confirmed) {
      nextPlan.status = "CONFIRMATION DETECTED";
      nextPlan.statusMessage = `A completed candle touched the original zone and closed in the ${plan.direction} direction. This is a research signal only; NOX has not placed an order.`;
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

function CandleChart({ candles, analysis }) {
  const visible = candles.slice(-55);

  if (!visible.length) return null;

  const width = 820;
  const height = 370;
  const left = 8;
  const right = 54;
  const top = 16;
  const bottom = 18;

  const values = visible.flatMap((c) => [c.high, c.low]);
  const baseMax = Math.max(...values);
  const baseMin = Math.min(...values);
  const baseSpan = Math.max(baseMax - baseMin, 1e-9);
  const suppliedChartLevels = Array.isArray(analysis?.chartLevels) ? analysis.chartLevels : [];

  const chartLevels = suppliedChartLevels.filter((item) =>
    item.type !== "support" && item.type !== "resistance"
  );

  const inViewLevels = chartLevels.filter((item) => {
    const value = Number.isFinite(item.price) ? item.price : (item.low + item.high) / 2;
    return value >= baseMin - baseSpan * 0.12 && value <= baseMax + baseSpan * 0.12;
  });
  const levelValues = inViewLevels.flatMap((item) =>
    Number.isFinite(item.price) ? [item.price] : [item.low, item.high]
  );
  const trendLines = (analysis?.trendContext?.trendLines || []).filter((line) =>
    [line.first?.price, line.second?.price, line.first?.epoch, line.second?.epoch].every((value) => Number.isFinite(Number(value)))
  );
  const firstVisibleEpoch = Number(visible[0]?.epoch);
  const lastVisibleEpoch = Number(visible.at(-1)?.epoch);
  const trendScaleValues = trendLines.flatMap((line) => [
    line.first.price,
    line.second.price,
    projectTrendLinePrice(line, firstVisibleEpoch),
    projectTrendLinePrice(line, lastVisibleEpoch),
  ]).filter(Number.isFinite);
  const scaleValues = [...values, ...levelValues, ...trendScaleValues];
  const max = Math.max(...scaleValues);
  const min = Math.min(...scaleValues);
  const span = Math.max(max - min, 1e-9);
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const step = plotWidth / visible.length;
  const y = (price) => top + ((max - price) / span) * plotHeight;

  const xForEpoch = (epoch) => {
    if (!Number.isFinite(Number(epoch)) || !Number.isFinite(firstVisibleEpoch) || !Number.isFinite(lastVisibleEpoch) || lastVisibleEpoch === firstVisibleEpoch) return null;
    const fraction = (Number(epoch) - firstVisibleEpoch) / (lastVisibleEpoch - firstVisibleEpoch);
    return left + step / 2 + fraction * (plotWidth - step);
  };

  const zoneLabelPositions = new Map(inViewLevels.map((item) => [item.id, y((item.low + item.high) / 2)]));

  const bodyWidth = Math.max(2, Math.min(8, step * 0.62));
  const recentVisible = visible.slice(-20);
  const averageRange = recentVisible.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / Math.max(1, recentVisible.length);
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
        aria-label="Historical candlestick chart with support, resistance and swing-based trend lines"
      >
        <defs>
          <linearGradient id="resistanceZoneFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#aa0000" stopOpacity="0.10" />
            <stop offset="55%" stopColor="#aa0000" stopOpacity="0.19" />
            <stop offset="100%" stopColor="#aa0000" stopOpacity="0.10" />
          </linearGradient>
          <linearGradient id="supportZoneFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#008f83" stopOpacity="0.10" />
            <stop offset="55%" stopColor="#31c99a" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#008f83" stopOpacity="0.10" />
          </linearGradient>
        </defs>

        {resistanceHigh > resistanceLow && (
          <rect x={left} y={y(resistanceHigh)} width={plotWidth}
            height={Math.max(2, y(resistanceLow) - y(resistanceHigh))}
            fill="url(#resistanceZoneFill)" />
        )}
        {supportHigh > supportLow && (
          <rect x={left} y={y(supportHigh)} width={plotWidth}
            height={Math.max(2, y(supportLow) - y(supportHigh))}
            fill="url(#supportZoneFill)" />
        )}

        {inViewLevels.map((item) => {
          if (item.type.startsWith("target-")) {
            const lineY = y(item.price);
            const lineClass = item.type === "target-up" ? "chart-target-up" : "chart-target-down";
            return (
              <g key={item.id} className="chart-analysis-level">
                <line x1={left} x2={left + plotWidth} y1={lineY} y2={lineY} className={lineClass} />
                <text x={left + plotWidth - 5} y={lineY - 5} textAnchor="end" className="chart-level-label">{item.label} {formatAxisPrice(item.price)}</text>
              </g>
            );
          }
          const isSupport = item.type.startsWith("support");
          const levelY = y((item.low + item.high) / 2);
          return (
            <g key={item.id} className={`chart-analysis-level ${item.type}`}>
              <rect x={left} y={y(item.high)} width={plotWidth} height={Math.max(2, y(item.low) - y(item.high))}
                className={`chart-level-fill ${isSupport ? "support-fill" : "resistance-fill"}`} />
              <text x={left + plotWidth - 5} y={Math.max(top + 9, Math.min(height - bottom - 3, levelY - 4))}
                textAnchor="end" className={`chart-level-label ${isSupport ? "support-label" : "resistance-label"}`}>
                {item.label} {formatAxisPrice(item.price)}
              </text>
            </g>
          );
        })}

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

        {trendLines.map((line) => {
          const firstEpoch = Number(line.first.epoch);
          const secondEpoch = Number(line.second.epoch);
          if (!Number.isFinite(firstEpoch) || !Number.isFinite(secondEpoch) || secondEpoch === firstEpoch) return null;
          const priceAt = (epoch) => line.first.price + ((line.second.price - line.first.price) / (secondEpoch - firstEpoch)) * (epoch - firstEpoch);
          const x1 = xForEpoch(firstEpoch);
          const x2 = xForEpoch(secondEpoch);
          const chartRight = left + plotWidth;
          return (
            <g key={line.id} className={`chart-trendline ${line.direction.toLowerCase()}`}>
              {/* Anchor the displayed trendline at Point 1, then project it forward. */}
              <line x1={x1} y1={y(line.first.price)} x2={chartRight} y2={y(priceAt(lastVisibleEpoch))}
                stroke={line.color} strokeWidth="1" opacity="0.95" />
              {x1 >= left && x1 <= chartRight && <circle cx={x1} cy={y(line.first.price)} r="2.2" fill={line.color} />}
              {x2 >= left && x2 <= chartRight && <circle cx={x2} cy={y(line.second.price)} r="2.2" fill={line.color} />}
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
      <header className="scenario-heading">
        <div className="scenario-heading-main">
          <span className={`signal-pill ${buy ? "buy-pill" : "sell-pill"}`}>
            {buy ? "↗ BUY" : "↘ SELL"}
          </span>
          <div className="scenario-heading-copy">
            <strong>{buy ? "Bullish breakout" : "Bearish breakdown"}</strong>
            <span>{buy ? "If price breaks upward" : "If price breaks downward"}</span>
          </div>
        </div>
      </header>

      <section className="scenario-watch">
        <div className="scenario-watch-label">
          <p>WATCH RETRACEMENT ZONE</p>
        </div>
        <div className="scenario-watch-panel">
          <div className="scenario-watch-prices">
            <CopyPrice value={watchLow} size="scenario-zone-price" />
            {hasRange && (
              <>
                <span className="scenario-watch-separator">–</span>
                <CopyPrice value={watchHigh} size="scenario-zone-price" />
              </>
            )}
          </div>
          <p className="scenario-zone-type">
            {scenario.zoneType || "Potential price area"}
          </p>
        </div>
        <p className="scenario-watch-hint">
          Wait for price to retest {buy ? "from above" : "from below"} before considering entry.
        </p>
      </section>

      <div className="risk-grid">
        <PriceStat label="POTENTIAL STOP LOSS" value={scenario.stopLoss} />
        <PriceStat label="POTENTIAL TAKE PROFIT" value={scenario.takeProfit} />
      </div>

      <section className="scenario-confirmation">
        <div className="scenario-detail-heading">
          <h4>CONFIRMATION CHECKLIST</h4>
        </div>
        <p>{scenario.confirmation}</p>
      </section>

      <details className="scenario-invalidation">
        <summary>
          <span>IF INVALIDATED</span>
          <span className="scenario-details-toggle" aria-hidden="true">＋</span>
        </summary>
        <p>{scenario.invalidation}</p>
      </details>
    </article>
  );
}

export default function App() {
  const [market, setMarket] = useState(null);
  const [search, setSearch] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [timeframe, setTimeframe] = useState(300);
  const [candles, setCandles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState("Not connected");
  const [error, setError] = useState("");
  const [derivMarkets, setDerivMarkets] = useState([]);
  const [marketStatus, setMarketStatus] = useState("Loading active Deriv markets…");
  const resumePendingRef = useRef(false);
  const resumeAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let client = null;

    async function loadDerivMarkets() {
      try {
        setMarketStatus("Connecting to Deriv and loading active markets…");
        client = await connectToDeriv();
        const activeSymbols = await client.getActiveSymbols();
        const seen = new Set();
        const markets = activeSymbols.map((item) => {
          const symbol = String(item.underlying_symbol || item.symbol || "").trim();
          if (!symbol || seen.has(symbol)) return null;
          seen.add(symbol);

          const displayName = String(
            item.underlying_symbol_name || item.display_name || item.name || symbol
          ).trim() || symbol;
          const marketName = String(
            item.market_display_name || item.market || item.market_name || "Other Deriv Markets"
          ).trim() || "Other Deriv Markets";
          const submarketName = String(
            item.submarket_display_name || item.submarket || item.submarket_name || ""
          ).trim();

          return {
            label: displayName,
            category: submarketName ? `${marketName} · ${submarketName}` : marketName,
            market: marketName,
            submarket: submarketName,
            symbol,
            provider: "deriv",
          };
        }).filter(Boolean).sort((a, b) =>
          a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
        );

        if (!markets.length) throw new Error("Deriv returned no usable active market symbols.");
        if (!cancelled) {
          setDerivMarkets(markets);
          setMarketStatus(`${markets.length} active Deriv markets available`);
        }
      } catch (err) {
        if (!cancelled) {
          setMarketStatus(`Deriv markets unavailable: ${err?.message || "unknown error"}`);
          setError(err?.message || "Could not load active Deriv markets.");
        }
      } finally {
        if (client?.close) client.close();
      }
    }

    loadDerivMarkets();
    return () => { cancelled = true; };
  }, []);

  const allMarkets = useMemo(() => derivMarkets, [derivMarkets]);
  const filteredMarkets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allMarkets.filter((item) =>
      `${item.label} ${item.category} ${item.market} ${item.submarket} ${item.symbol}`
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

      setConnection("Connecting to Deriv market data…");
      client = await connectToDeriv();
      data = await getCandles(client, market.symbol, timeframe, 300);

      if (!data?.length) {
        throw new Error("Deriv returned no candles for this symbol. Confirm the symbol is currently active on Deriv.");
      }

      data = data.map(normalizeCandle);
      setConnection("Data received · Deriv market data");

      if (!data.length) {
        throw new Error("The selected market returned no usable candles.");
      }

      const storageKey = getPlanStorageKey(market, timeframe);
      const memoryKey = getChartMemoryKey(market, timeframe);
      const oldMemory = readChartMemory(memoryKey);
      const completedFetched = getCompletedCandles(data, timeframe);
      const mergedCandles = mergeCandleHistory(oldMemory.candles, completedFetched);
      if (mergedCandles.length < 5) {
        throw new Error("There are not enough completed candles yet to analyze this timeframe.");
      }

      const savedPlan = readSavedPlan(storageKey);
      const savedPlanMatchesMarket = savedPlan?.marketKey === storageKey;
      const savedPlanWasAlreadyTerminal =
        savedPlanMatchesMarket && PLAN_TERMINAL_STATUSES.has(savedPlan.status);

      // A finished/invalidated setup must not become the reference point for
      // the next analysis. Keep candle history, but start observation memory fresh.
      const startingObservations = savedPlanWasAlreadyTerminal ? [] : oldMemory.observations;
      let marketStory = buildMarketStory(
        mergedCandles,
        startingObservations.at(-1) || null
      );
      let updatedMemory = recordChartObservation(
        { candles: mergedCandles, observations: startingObservations },
        marketStory
      );

      const saveChartMemory = (memory) => {
        try {
          window.localStorage.setItem(memoryKey, JSON.stringify(memory));
        } catch {
          // Analysis still works when browser storage is disabled or full.
        }
      };
      const makeMemoryInfo = (memory) => ({
        candleCount: mergedCandles.length,
        observationCount: memory.observations.length,
        observations: memory.observations.slice(-6).reverse(),
      });

      saveChartMemory(updatedMemory);
      let memoryInfo = makeMemoryInfo(updatedMemory);
      setCandles(mergedCandles);

      const runFreshAnalysis = (story, info) => {
        const freshAnalysis = enforceMinimumRewardRisk(analyzeCandles(mergedCandles, timeframe));
        freshAnalysis.marketStory = story;
        freshAnalysis.memoryInfo = info;
        const side = freshAnalysis.action.toLowerCase();
        const hasDirectionalSetup =
          ["BUY", "SELL"].includes(freshAnalysis.action) && Boolean(freshAnalysis[side]);

        if (hasDirectionalSetup) {
          const newPlan = createActivePlan(freshAnalysis, storageKey, mergedCandles);
          savePlan(storageKey, newPlan);
          setAnalysis(presentActivePlan(newPlan, story, info));
        } else {
          removeSavedPlan(storageKey);
          setAnalysis(freshAnalysis);
        }
      };

      const savedPlanIsUsable =
        savedPlanMatchesMarket &&
        !savedPlanWasAlreadyTerminal &&
        ["BUY", "SELL"].includes(savedPlan.direction);

      if (savedPlanIsUsable) {
        // Rebuild the current conclusion on every scan before allowing historical
        // plan memory to remain active. Memory is context, never a permanent bias.
        const currentAnalysis = enforceMinimumRewardRisk(analyzeCandles(mergedCandles, timeframe));
        const currentDirection = currentAnalysis.action;
        const savedDirectionStillAgrees = currentDirection === savedPlan.direction;
        const currentStructure = currentAnalysis.trendContext?.major || "NEUTRAL";
        const savedStructure =
          savedPlan.analysisSnapshot?.trendContext?.major ||
          savedPlan.trendContext?.major ||
          savedPlan.marketStructure ||
          null;
        const structureStillAgrees = !savedStructure || savedStructure === currentStructure;
        const savedLine = savedPlan.analysisSnapshot?.trendContext?.trendLines?.[0] || null;
        const currentLine = currentAnalysis.trendContext?.trendLines?.[0] || null;
        const sameTrendLine =
          (!savedLine && !currentLine) ||
          Boolean(
            savedLine &&
            currentLine &&
            savedLine.direction === currentLine.direction &&
            Number(savedLine.first?.epoch) === Number(currentLine.first?.epoch) &&
            Number(savedLine.second?.epoch) === Number(currentLine.second?.epoch)
          );
        const memoryStillValid =
          savedDirectionStillAgrees &&
          structureStillAgrees &&
          sameTrendLine;

        if (!memoryStillValid) {
          removeSavedPlan(storageKey);
          marketStory = buildMarketStory(mergedCandles, null);
          updatedMemory = recordChartObservation(
            { candles: mergedCandles, observations: [] },
            marketStory
          );
          saveChartMemory(updatedMemory);
          memoryInfo = makeMemoryInfo(updatedMemory);
          runFreshAnalysis(marketStory, memoryInfo);
        } else {
          const updatedPlan = updateActivePlan(savedPlan, mergedCandles, timeframe);

          if (PLAN_TERMINAL_STATUSES.has(updatedPlan.status)) {
          // The plan became invalid/completed on this scan. Drop its old bias
          // immediately and rebuild the report from current candles only.
          removeSavedPlan(storageKey);
          marketStory = buildMarketStory(mergedCandles, null);
          updatedMemory = recordChartObservation(
            { candles: mergedCandles, observations: [] },
            marketStory
          );
          saveChartMemory(updatedMemory);
          memoryInfo = makeMemoryInfo(updatedMemory);
          runFreshAnalysis(marketStory, memoryInfo);
          } else {
            savePlan(storageKey, updatedPlan);
            setAnalysis(presentActivePlan(updatedPlan, marketStory, memoryInfo));
          }
        }
      } else {
        if (savedPlanWasAlreadyTerminal) removeSavedPlan(storageKey);
        runFreshAnalysis(marketStory, memoryInfo);
      }

      setConnection("Data received · Deriv market data");
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

  useEffect(() => {
    if (resumeAttemptedRef.current || marketStatus.startsWith("Loading") || marketStatus.startsWith("Connecting")) return;
    resumeAttemptedRef.current = true;

    const savedSession = readSavedSession();
    if (!savedSession?.symbol || !Number.isFinite(Number(savedSession.timeframe))) return;

    const restoredMarket = allMarkets.find((item) => {
      return item.provider === "deriv" && item.symbol === savedSession.symbol;
    });

    if (!restoredMarket) return;

    resumePendingRef.current = true;
    setMarket(restoredMarket);
    setSearch(restoredMarket.label);
    setTimeframe(Number(savedSession.timeframe));
    setSuggestionsOpen(false);
  }, [allMarkets, marketStatus]);

  useEffect(() => {
    if (!resumePendingRef.current || !market) return;
    resumePendingRef.current = false;
    runAnalysis();
  }, [market, timeframe]);

  useEffect(() => {
    if (market) saveSession(market, timeframe);
  }, [market, timeframe]);

  const providerDescription = "Connecting to Deriv and requesting historical candles. No orders will be placed.";

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
              placeholder="Search all active Deriv markets…"
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
                  key={`${item.symbol}`}
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
                  No matching markets. {marketStatus}
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

        <p className="market-status">{marketStatus}</p>
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

          <CandleChart candles={candles} analysis={analysis} />
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

          {analysis.trendContext && (
            <div className="trend-context-strip">
              <div className="trend-context-item">
                <span>MAJOR TREND</span>
                <strong>{analysis.trendContext.major}</strong>
              </div>
            </div>
          )}

          {analysis.trendContext && (
            <div className="trend-zone-summary">
              {[
                ["SUPPORT", analysis.trendContext.support],
                ["RESISTANCE", analysis.trendContext.resistance],
              ].map(([label, zone]) => (
                <div className="trend-zone-item" key={label}>
                  <span>{label}</span>
                  {zone ? (
                    <CopyPrice value={zone.price} size="trend-zone-price" />
                  ) : (
                    <strong>Not identified</strong>
                  )}
                </div>
              ))}
            </div>
          )}

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

          <div className="signal-card major-swing-card">
            <div className="signal-card-top">
              <div>
                <span className="field-label">MAJOR SWING TREND LINES</span>
                <h3>WAIT</h3>
              </div>
              <div className="setup-type">
                <span className="field-label">SETUP TYPE</span>
                <strong>Breakout and retest</strong>
              </div>
            </div>
            <div className="wait-message">
              <h4>WHAT TO WAIT FOR</h4>
              <p>
                {analysis.trendContext?.trendLines?.length
                  ? analysis.trendContext.major === "BULLISH"
                    ? "Wait for a candle close outside the range, then a retest that holds. A bullish candle after an upper retest supports a buy idea; a bearish candle after a lower retest supports a sell idea. Use the single major swing trend line in the direction of the confirmed trend as the entry reference; require the retest candle to close in that direction."
                    : analysis.trendContext.major === "BEARISH"
                      ? "Wait for a candle close outside the range, then a retest that holds. A bullish candle after an upper retest supports a buy idea; a bearish candle after a lower retest supports a sell idea. Use the single major swing trend line in the direction of the confirmed trend as the entry reference; require the retest candle to close in that direction."
                      : "Wait until a clear major swing direction is confirmed. A diagonal trendline is optional and must be independently validated."
                  : "NO CONFIRMED TRENDLINE. Major market structure can still be bullish or bearish; wait for a valid diagonal line before using one as an entry reference."}
              </p>
            </div>

            {(analysis.trendContext?.trendLines || []).map((line) => (
              <section
                className={`scenario-watch major-swing-watch ${line.direction === "BULLISH" ? "bullish" : "bearish"}`}
                key={line.id}
              >
                <div className="scenario-watch-label">
                  <p>{line.direction === "BULLISH" ? "MAJOR BULLISH SWING TREND LINE" : "MAJOR BEARISH SWING TREND LINE"}</p>
                </div>

                <div className="scenario-watch-panel">
                  {/* Projected trend-line price removed. Only the two anchor prices remain. */}
                  <div className="trendline-anchor-grid">
                    <div className="trendline-anchor">
                      <span>POINT 1</span>
                      <div className="trendline-anchor-values">
                        <CopyPrice value={line.first.price} copyFirst />
                        <div className="price-stat swing-bar-stat">
                          <span className="price-stat-label">SWING BAR</span>
                          <CopyBar value={line.first.bar} />
                        </div>
                      </div>
                    </div>
                    <div className="trendline-anchor">
                      <span>POINT 2</span>
                      <div className="trendline-anchor-values">
                        <CopyPrice value={line.second.price} copyFirst />
                        <div className="price-stat swing-bar-stat">
                          <span className="price-stat-label">SWING BAR</span>
                          <CopyBar value={line.second.bar} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ))}
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
            support, resistance and swing-based trend lines. Major swing structure and horizontal levels are conditional references,
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