
import { Fragment, useEffect, useMemo, useState } from "react";
import "./News.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const REFRESH_CALENDAR_MS = 15 * 60 * 1000;
const REFRESH_CRYPTO_MS = 10 * 60 * 1000;

function formatLocalTime(value) {
  if (!value) return "Time unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAge(value) {
  if (!value) return "Time unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function shownValue(value) {
  return value === null ||
    value === undefined ||
    String(value).trim() === ""
    ? "—"
    : String(value);
}

async function getJson(url) {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      "The backend did not return JSON. Confirm the backend is running."
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

function getMarketSearchInfo(searchText) {
  const query = searchText.trim().toLowerCase().replace(/\s+/g, "");

  if (
    ["xauusd", "xau/usd", "gold", "goldusd", "gold/usd"].includes(query)
  ) {
    return {
      type: "gold",
      eventCurrencies: ["USD"],
      keywords: [
        "gold",
        "bullion",
        "precious metals",
        "xauusd",
        "xau/usd",
        "federal reserve",
        "fed ",
        "interest rate",
        "inflation",
        "treasury yields",
        "us dollar",
        "central bank",
      ],
    };
  }

  const forexPairs = [
    { symbols: ["eurusd", "eur/usd"], currencies: ["EUR", "USD"] },
    { symbols: ["gbpusd", "gbp/usd"], currencies: ["GBP", "USD"] },
    { symbols: ["usdcad", "usd/cad"], currencies: ["USD", "CAD"] },
    { symbols: ["usdjpy", "usd/jpy"], currencies: ["USD", "JPY"] },
    { symbols: ["audusd", "aud/usd"], currencies: ["AUD", "USD"] },
    { symbols: ["nzdusd", "nzd/usd"], currencies: ["NZD", "USD"] },
    { symbols: ["usdchf", "usd/chf"], currencies: ["USD", "CHF"] },
  ];

  const pair = forexPairs.find((item) => item.symbols.includes(query));

  if (pair) {
    return {
      type: "forex",
      eventCurrencies: pair.currencies,
      keywords: [],
    };
  }

  const cryptoAssets = [
    {
      symbols: ["btcusd", "btc/usd", "bitcoin", "btc"],
      name: "Bitcoin",
      keywords: ["bitcoin", "btc"],
    },
    {
      symbols: ["ethusd", "eth/usd", "ethereum", "eth"],
      name: "Ethereum",
      keywords: ["ethereum", "ether", "eth"],
    },
    {
      symbols: ["solusd", "sol/usd", "solana", "sol"],
      name: "Solana",
      keywords: ["solana", "sol"],
    },
    {
      symbols: ["xrpusd", "xrp/usd", "ripple", "xrp"],
      name: "XRP",
      keywords: ["xrp", "ripple"],
    },
    {
      symbols: ["bnbusd", "bnb/usd", "binancecoin", "bnb"],
      name: "BNB",
      keywords: ["bnb", "binance coin", "binancecoin"],
    },
    {
      symbols: ["dogeusd", "doge/usd", "dogecoin", "doge"],
      name: "Dogecoin",
      keywords: ["dogecoin", "doge"],
    },
    {
      symbols: ["adausd", "ada/usd", "cardano", "ada"],
      name: "Cardano",
      keywords: ["cardano", "ada"],
    },
    {
      symbols: ["avaxusd", "avax/usd", "avalanche", "avax"],
      name: "Avalanche",
      keywords: ["avalanche", "avax"],
    },
    {
      symbols: ["linkusd", "link/usd", "chainlink", "link"],
      name: "Chainlink",
      keywords: ["chainlink", "link"],
    },
    {
      symbols: ["ltcusd", "ltc/usd", "litecoin", "ltc"],
      name: "Litecoin",
      keywords: ["litecoin", "ltc"],
    },
    {
      symbols: ["dotusd", "dot/usd", "polkadot", "dot"],
      name: "Polkadot",
      keywords: ["polkadot", "dot"],
    },
    {
      symbols: ["trxusd", "trx/usd", "tron", "trx"],
      name: "TRON",
      keywords: ["tron", "trx"],
    },
    {
      symbols: ["suiusd", "sui/usd", "sui"],
      name: "Sui",
      keywords: ["sui"],
    },
    {
      symbols: ["tonusd", "ton/usd", "toncoin", "ton"],
      name: "Toncoin",
      keywords: ["toncoin", "ton"],
    },
    {
      symbols: ["shibusd", "shib/usd", "shibainu", "shiba inu", "shib"],
      name: "Shiba Inu",
      keywords: ["shiba inu", "shibainu", "shib"],
    },
  ];

  const crypto = cryptoAssets.find((item) =>
    item.symbols.includes(query)
  );

  if (crypto) {
    return {
      type: "crypto",
      name: crypto.name,
      keywords: crypto.keywords,
    };
  }

  return null;
}

function getEventStatus(event, serverTime) {
  const releaseTime = Number(event.ts || 0);
  const parsedServerTime = Number(serverTime);

  const now =
    Number.isFinite(parsedServerTime) && parsedServerTime > 0
      ? parsedServerTime
      : Math.floor(Date.now() / 1000);

  if (!releaseTime || now < releaseTime) {
    return {
      label: "UPCOMING",
      released: false,
      actualAvailable: false,
    };
  }

  const actualAvailable =
    event.actual !== null &&
    event.actual !== undefined &&
    String(event.actual).trim() !== "";

  return {
    label: actualAvailable ? "RELEASED" : "RELEASED · AWAITING ACTUAL",
    released: true,
    actualAvailable,
  };
}

function getActualVsForecast(event) {
  const actualText = String(event.actual ?? "").trim();
  const forecastText = String(event.forecast ?? "").trim();

  if (!actualText || !forecastText) {
    return {
      label: "INSUFFICIENT DATA",
      explanation:
        "Actual or forecast data is missing. NOX cannot reliably compare this release yet.",
    };
  }

  const parseNumber = (value) => {
    const cleaned = value.replace(/,/g, "").replace(/%/g, "").trim();
    const match = cleaned.match(/^[+-]?(?:\d+\.?\d*|\.\d+)/);
    return match ? Number(match[0]) : null;
  };

  const actual = parseNumber(actualText);
  const forecast = parseNumber(forecastText);

  if (
    actual === null ||
    forecast === null ||
    !Number.isFinite(actual) ||
    !Number.isFinite(forecast)
  ) {
    if (actualText === forecastText) {
      return {
        label: "IN LINE",
        explanation:
          "The published values match as text. Their economic meaning and market reaction still need to be assessed.",
      };
    }

    return {
      label: "MANUAL INTERPRETATION NEEDED",
      explanation:
        "The values are not simple numbers. Interpret the specific indicator before assessing the release.",
    };
  }

  if (actual > forecast) {
    return {
      label: "ABOVE FORECAST",
      explanation:
        "Actual is numerically higher than forecast. Whether that supports the currency depends on the indicator.",
    };
  }

  if (actual < forecast) {
    return {
      label: "BELOW FORECAST",
      explanation:
        "Actual is numerically lower than forecast. Whether that supports the currency depends on the indicator.",
    };
  }

  return {
    label: "IN LINE",
    explanation:
      "Actual matches forecast numerically. The previous value and market reaction may still matter.",
  };
}

function getArticleDate(article) {
  const value =
    article.pubDate ||
    article.publishedAt ||
    article.published_at ||
    article.date ||
    "";

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export default function NewsWorkspace() {
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("ALL");
  const [impact, setImpact] = useState("high,medium");

  const [calendar, setCalendar] = useState(null);
  const [cryptoNews, setCryptoNews] = useState(null);

  const [calendarLoading, setCalendarLoading] = useState(true);
  const [cryptoLoading, setCryptoLoading] = useState(true);

  const [calendarError, setCalendarError] = useState("");
  const [cryptoError, setCryptoError] = useState("");

  const [lastUpdated, setLastUpdated] = useState({
    calendar: null,
    crypto: null,
  });

  const [expandedEventKey, setExpandedEventKey] = useState(null);

  async function loadCalendar(isRefresh = false) {
    if (!isRefresh) setCalendarLoading(true);

    try {
      const params = new URLSearchParams({
        currency:
          currency === "ALL"
            ? "USD,EUR,GBP,CAD,JPY,AUD,NZD,CHF,CNY"
            : currency,
        impact,
        days: "7",
      });

      const data = await getJson(
        `${API_BASE_URL}/api/news/calendar?${params.toString()}`
      );

      setCalendar(data);
      setCalendarError("");

      setLastUpdated((previous) => ({
        ...previous,
        calendar: new Date().toISOString(),
      }));
    } catch (error) {
      setCalendarError(
        error?.message || "Unable to load the economic calendar."
      );
    } finally {
      setCalendarLoading(false);
    }
  }

  async function loadCrypto(searchText = "", isRefresh = false) {
    if (!isRefresh) setCryptoLoading(true);

    try {
      const rawQuery = searchText.trim();
      const marketInfo = getMarketSearchInfo(rawQuery);

      const params = new URLSearchParams();

      if (rawQuery && marketInfo?.type === "crypto") {
        // Search using the full asset name to reduce ambiguous ticker matches.
        params.set("q", marketInfo.name);
      } else if (rawQuery && !marketInfo) {
        // Supports coins that are not in our built-in alias list.
        params.set("q", rawQuery);
      }

      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await getJson(
        `${API_BASE_URL}/api/news/crypto${suffix}`
      );

      setCryptoNews(data);
      setCryptoError("");

      setLastUpdated((previous) => ({
        ...previous,
        crypto: new Date().toISOString(),
      }));
    } catch (error) {
      setCryptoError(
        error?.message || "Unable to load crypto headlines."
      );
    } finally {
      setCryptoLoading(false);
    }
  }

  // Load and refresh the economic calendar.
  useEffect(() => {
    loadCalendar();

    const timer = window.setInterval(
      () => loadCalendar(true),
      REFRESH_CALENDAR_MS
    );

    return () => window.clearInterval(timer);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendar();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, impact]);

  // Search after the user pauses typing.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCrypto(search);
    }, 500);

    return () => window.clearTimeout(timer);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Refresh the currently selected crypto search every ten minutes.
  useEffect(() => {
    const timer = window.setInterval(
      () => loadCrypto(search, true),
      REFRESH_CRYPTO_MS
    );

    return () => window.clearInterval(timer);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = search.trim().toLowerCase();
  const marketSearch = getMarketSearchInfo(search);

  const events = useMemo(() => {
    const items = Array.isArray(calendar?.events)
      ? calendar.events
      : [];

    return items
      .filter((event) => {
        const title = String(event.title || "").toLowerCase();
        const eventCurrency = String(event.currency || "").toUpperCase();

        const matchesCurrency =
          currency === "ALL" || eventCurrency === currency;

        let matchesQuery = !query;

        if (query && marketSearch?.type === "gold") {
          matchesQuery =
            marketSearch.eventCurrencies.includes(eventCurrency) ||
            title.includes("gold") ||
            title.includes("bullion");
        } else if (query && marketSearch?.type === "forex") {
          matchesQuery =
            marketSearch.eventCurrencies.includes(eventCurrency);
        } else if (query && marketSearch?.type === "crypto") {
          matchesQuery = false;
        } else if (query) {
          const searchableText = [
            event.title,
            event.currency,
            event.impact,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          matchesQuery = searchableText.includes(query);
        }

        return matchesQuery && matchesCurrency;
      })
      .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  }, [calendar, query, currency, marketSearch]);

  const articles = useMemo(() => {
    const items = Array.isArray(cryptoNews?.articles)
      ? cryptoNews.articles
      : [];

    const sorted = [...items].sort(
      (a, b) => getArticleDate(b) - getArticleDate(a)
    );

    if (!query) return sorted;

    // Crypto searches are performed by the backend.
    if (marketSearch?.type === "crypto") return sorted;

    // Economic news for gold and forex belongs in the calendar,
    // not in the crypto news feed.
    if (marketSearch?.type === "gold" || marketSearch?.type === "forex") {
      return [];
    }

    // Other coin names and keywords have already been searched by the API.
    return sorted;
  }, [cryptoNews, query, marketSearch]);

  const cryptoSearchLabel = search.trim()
    ? marketSearch?.type === "crypto"
      ? marketSearch.name
      : search.trim()
    : "all cryptocurrencies";

  return (
    <main className="news-workspace">
      <section className="news-heading">
        <div>
          <p className="news-eyebrow">NOX · NEWS INTELLIGENCE</p>
          <h2>Events &amp; catalysts</h2>
          <p>
            Track scheduled economic releases and crypto headlines.
            Data is informational; market reactions are uncertain.
          </p>
        </div>

        <span className="news-live-tag">RESEARCH MODE</span>
      </section>

      <label
        className="news-search"
        aria-label="Search events and crypto headlines"
      >
        <span aria-hidden="true">⌕</span>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search a market or crypto: EURUSD, Bitcoin, SOL, XRP…"
        />

        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </label>

      <section className="news-panel">
        <div className="news-panel-header">
          <div>
            <p className="news-eyebrow">FOREX CALENDAR</p>
            <h3>Upcoming economic releases</h3>
            <p>Times are shown in your device&apos;s local timezone.</p>
          </div>

          <button
            className="news-refresh"
            type="button"
            onClick={() => loadCalendar()}
            disabled={calendarLoading}
          >
            ↻ Refresh
          </button>
        </div>

        <div className="news-filters">
          <label>
            Currency
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="ALL">All major currencies</option>
              <option value="USD">USD · US dollar</option>
              <option value="EUR">EUR · Euro</option>
              <option value="GBP">GBP · Pound</option>
              <option value="CAD">CAD · Canadian dollar</option>
              <option value="JPY">JPY · Yen</option>
              <option value="AUD">AUD · Australian dollar</option>
              <option value="NZD">NZD · New Zealand dollar</option>
              <option value="CHF">CHF · Swiss franc</option>
              <option value="CNY">CNY · Chinese yuan</option>
            </select>
          </label>

          <label>
            Impact
            <select
              value={impact}
              onChange={(event) => setImpact(event.target.value)}
            >
              <option value="high,medium">High + medium</option>
              <option value="high">High only</option>
              <option value="high,medium,low">All releases</option>
            </select>
          </label>

          <span className="news-count">{events.length} events</span>
        </div>

        {calendarLoading && !calendar && (
          <p className="news-state">Loading economic calendar…</p>
        )}

        {calendarError && (
          <div className="news-error">
            <strong>Calendar unavailable</strong>
            <span>{calendarError}</span>
            <button type="button" onClick={() => loadCalendar()}>
              Try again
            </button>
          </div>
        )}

        {!calendarLoading && !calendarError && events.length === 0 && (
          <p className="news-state">
            No events match this search and filter.
          </p>
        )}

        {events.length > 0 && (
          <div className="news-table-wrap">
            <table className="news-table">
              <thead>
                <tr>
                  <th>Local time</th>
                  <th>Event</th>
                  <th>Currency</th>
                  <th>Actual</th>
                  <th>Forecast</th>
                  <th>Previous</th>
                </tr>
              </thead>

              <tbody>
                {events.map((event, index) => {
                  const eventKey =
                    `${event.ts}-${event.currency}-${event.title}-${index}`;

                  const isExpanded = expandedEventKey === eventKey;
                  const status = getEventStatus(
                    event,
                    calendar?.server_time
                  );

                  const comparison = getActualVsForecast(event);

                  const impactClass = String(
                    event.impact || "low"
                  ).toLowerCase();

                  return (
                    <Fragment key={eventKey}>
                      <tr>
                        <td className="news-time">
                          {formatLocalTime(
                            event.time ||
                              (event.ts
                                ? Number(event.ts) * 1000
                                : "")
                          )}
                        </td>

                        <td className="news-event-title">
                          <button
                            type="button"
                            className={`news-event-expand impact-highlight impact-${impactClass}`}
                            aria-expanded={isExpanded}
                            onClick={() =>
                              setExpandedEventKey(
                                isExpanded ? null : eventKey
                              )
                            }
                          >
                            <span>{event.title || "Untitled event"}</span>
                            <span aria-hidden="true">
                              {isExpanded ? "−" : "+"}
                            </span>
                          </button>
                        </td>

                        <td>
                          <span className="news-currency">
                            {event.currency || "—"}
                          </span>
                        </td>

                        <td>{shownValue(event.actual)}</td>
                        <td>{shownValue(event.forecast)}</td>
                        <td>{shownValue(event.previous)}</td>
                      </tr>

                      {isExpanded && (
                        <tr className="news-expanded-row">
                          <td colSpan={6}>
                            <div className="news-event-details">
                              <div className="news-event-details-header">
                                <div>
                                  <p className="news-eyebrow">
                                    EVENT ANALYSIS
                                  </p>
                                  <h4>
                                    {event.title || "Untitled event"}
                                  </h4>
                                </div>

                                <span className="news-event-status">
                                  {status.label}
                                </span>
                              </div>

                              <div className="news-event-values">
                                <div>
                                  <span>Actual</span>
                                  <strong>{shownValue(event.actual)}</strong>
                                </div>

                                <div>
                                  <span>Forecast</span>
                                  <strong>{shownValue(event.forecast)}</strong>
                                </div>

                                <div>
                                  <span>Previous</span>
                                  <strong>{shownValue(event.previous)}</strong>
                                </div>
                              </div>

                              {!status.released ? (
                                <div className="news-outlook news-outlook-wait">
                                  <strong>OUTLOOK: WAIT</strong>
                                  <p>
                                    This event has not reached its scheduled
                                    release time. NOX will not generate a
                                    BUY/SELL outlook before release.
                                  </p>
                                </div>
                              ) : !status.actualAvailable ? (
                                <div className="news-outlook news-outlook-wait">
                                  <strong>
                                    OUTLOOK: WAIT / NO CLEAR EDGE
                                  </strong>
                                  <p>
                                    The scheduled release time has passed,
                                    but the actual value is not available
                                    yet. Wait for the provider to publish it.
                                  </p>
                                </div>
                              ) : (
                                <div className="news-outlook news-outlook-wait">
                                  <strong>
                                    OUTLOOK: WAIT / NO CLEAR EDGE
                                  </strong>
                                  <p>
                                    Actual data is available, but historical
                                    reactions and recent price action have
                                    not yet been connected to this panel.
                                    NOX will not guess a direction without
                                    that evidence.
                                  </p>

                                  <div className="news-comparison">
                                    <strong>
                                      ACTUAL VS FORECAST: {comparison.label}
                                    </strong>
                                    <p>{comparison.explanation}</p>
                                  </div>
                                </div>
                              )}

                              <p className="news-analysis-note">
                                A higher or lower figure does not
                                automatically mean BUY or SELL. Indicator
                                meaning, market expectations, historical
                                reactions, and current price action all
                                matter.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="news-source-line">
          <span>
            Data by{" "}
            <a
              href={
                calendar?.attribution?.url ||
                "https://showmytrades.com/tools/economic-calendar"
              }
              target="_blank"
              rel="noreferrer"
            >
              {calendar?.attribution?.text ||
                "ShowMyTrades Economic Calendar"}
            </a>
          </span>

          <span>
            {lastUpdated.calendar
              ? `Updated ${formatAge(lastUpdated.calendar)}`
              : "Waiting for data"}
          </span>
        </div>
      </section>

      <section className="news-panel">
        <div className="news-panel-header">
          <div>
            <p className="news-eyebrow">CRYPTO CATALYSTS</p>
            <h3>
              {search.trim()
                ? `Latest news: ${cryptoSearchLabel}`
                : "Latest crypto headlines"}
            </h3>
            <p>
              {search.trim()
                ? `Recent news search for "${cryptoSearchLabel}".`
                : "Aggregated headlines from crypto news sources."}
              {" "}Open the original source for the full article.
            </p>
          </div>

          <button
            className="news-refresh"
            type="button"
            onClick={() => loadCrypto(search)}
            disabled={cryptoLoading}
          >
            ↻ Refresh
          </button>
        </div>

        {cryptoLoading && (
          <p className="news-state">
            Searching {cryptoSearchLabel} news…
          </p>
        )}

        {cryptoError && (
          <div className="news-error">
            <strong>Crypto news unavailable</strong>
            <span>{cryptoError}</span>
            <button
              type="button"
              onClick={() => loadCrypto(search)}
            >
              Try again
            </button>
          </div>
        )}

        {!cryptoLoading && !cryptoError && articles.length === 0 && (
          <p className="news-state">
            {search.trim()
              ? `No matching recent articles were returned for "${cryptoSearchLabel}". Try the coin's full name or ticker symbol.`
              : "No crypto headlines are available right now."}
          </p>
        )}

        <div className="news-article-list">
          {articles.map((article, index) => (
            <article
              className="news-article"
              key={`${article.link || article.title}-${index}`}
            >
              <div className="news-article-meta">
                <span>{article.source || "Unknown source"}</span>
                <span>{formatAge(
                  article.pubDate ||
                  article.publishedAt ||
                  article.published_at ||
                  article.date
                )}</span>

                {article.category && (
                  <span className="news-category">
                    {article.category}
                  </span>
                )}
              </div>

              <h4>{article.title || "Untitled headline"}</h4>

              {article.description && <p>{article.description}</p>}

              {article.link && (
                <a
                  className="news-read-link"
                  href={article.link.replace(/&amp;/g, "&")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original source ↗
                </a>
              )}
            </article>
          ))}
        </div>

        <div className="news-source-line">
          <span>
            News source:{" "}
            <a
              href="https://cryptocurrency.cv/"
              target="_blank"
              rel="noreferrer"
            >
              Free Crypto News
            </a>
          </span>

          <span>
            {cryptoNews?.limited
              ? "Free tier · 3 articles per response"
              : "Aggregated feed"}
            {lastUpdated.crypto
              ? ` · Updated ${formatAge(lastUpdated.crypto)}`
              : ""}
          </span>
        </div>
      </section>

      <p className="news-disclaimer">
        Research only · No live orders enabled · Event data may change ·
        A headline or release does not determine price direction by itself.
      </p>
    </main>
  );
}
