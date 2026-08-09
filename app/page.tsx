'use client';

import { useEffect, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';

type Driver = { driver: string; impact: string; sentiment?: number; snippet?: string };

type Transcript = {
  path: string;
  date: string | null;
  quarter: string;
  sentiment_score: number;
  sentiment_label: string;
  price_0d: number | null;
  return_7d_pct: number | null;
  return_14d_pct: number | null;
  return_21d_pct: number | null;
  return_30d_pct: number | null;
  analysis_source?: 'claude' | 'vader';
  outlook_snippet?: string | null;
  future_outlook_snippet?: string | null;
  drivers?: Driver[] | null;
  driver_summary?: string[] | null;
  tone?: string | null;
  confidence_level?: string | null;
  forward_looking_strength?: string | null;
  risk_caution_notes?: string[] | null;
  key_themes?: string[] | null;
  notable_quotes?: string[] | null;
};

type Analysis = {
  company: string;
  generated_at: string;
  transcripts: Transcript[];
  summary: Record<string, number | null>;
  horizons_days: number[];
};

export default function Dashboard() {
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/analysis.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('No data'))))
      .then(setData)
      .catch(() => setError('No analysis found. Add PDFs to data/transcripts/ and Excel to data/, then run: npm run process'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container">
        <p className="no-data">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container">
        <h1>RH Earnings Sentiment vs Price</h1>
        <p className="no-data">{error || 'No data'}</p>
      </div>
    );
  }

  const { transcripts, summary, horizons_days } = data;
  const hasTranscripts = transcripts.length > 0;

  // Scatter: sentiment (x) vs return (y) for 7d and 30d
  const scatter7 = transcripts
    .filter((t) => t.date && t.return_7d_pct != null)
    .map((t) => ({ x: t.sentiment_score, y: t.return_7d_pct, name: t.quarter || t.date }));
  const scatter30 = transcripts
    .filter((t) => t.date && t.return_30d_pct != null)
    .map((t) => ({ x: t.sentiment_score, y: t.return_30d_pct, name: t.quarter || t.date }));

  const sentimentDomain = (points: { x: number }[]) => {
    const xs = points.map((p) => p.x);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const pad = Math.max(0.2, (max - min) * 0.2 || 0.2);
    return [Math.max(-1, min - pad), Math.min(1, max + pad)];
  };
  const returnDomain = (points: { y: number }[]) => {
    const ys = points.map((p) => p.y);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const pad = Math.max(5, (max - min) * 0.15 || 5);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  };

  // Bar: sentiment by call (separate so scale is clear)
  const sentimentBarData = transcripts
    .filter((t) => t.date)
    .map((t) => ({ label: t.quarter || t.date!.slice(0, 7), sentiment: t.sentiment_score }));
  // Bar: returns by call (percent)
  const returnsBarData = transcripts
    .filter((t) => t.date)
    .map((t) => ({
      label: t.quarter || t.date!.slice(0, 7),
      return_7d: t.return_7d_pct ?? undefined,
      return_14d: t.return_14d_pct ?? undefined,
      return_21d: t.return_21d_pct ?? undefined,
      return_30d: t.return_30d_pct ?? undefined,
    }));

  const formatPct = (v: number | null | undefined) =>
    v != null ? `${v >= 0 ? '+' : ''}${v}%` : '—';

  return (
    <div className="container">
      <h1>{data.company} Earnings Sentiment vs Price Impact</h1>
      <p className="subtitle">
        Sentiment = management tone from the call (outlook, drivers, guidance). Stock return = what actually happened after the call. They can diverge: management may sound positive while the stock falls on macro or other news.
      </p>

      {!hasTranscripts && (
        <div className="card">
          <p className="no-data">No transcripts processed. Add PDFs to <code>data/transcripts/</code> and run <code>npm run process</code>.</p>
        </div>
      )}

      {hasTranscripts && (
        <>
          {/* Summary correlations */}
          <div className="card">
            <h2>Does management tone predict the stock?</h2>
            <p className="card-desc">Correlation between call sentiment and subsequent stock return. Positive = when management sounded more positive, the stock tended to do better.</p>
            <div className="summary-grid">
              {horizons_days.map((h) => {
                const key = `correlation_sentiment_return_${h}d`;
                const val = summary[key];
                return (
                  <div key={h} className="summary-item">
                    <strong>{h} days</strong>
                    <span>{val != null ? val.toFixed(2) : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Table */}
          <div className="card">
            <h2>By earnings call</h2>
            <p className="card-desc">Management sentiment from the call (left) vs actual stock return after the call (right). Mismatches are normal: e.g. stock can drop −30% even when tone was positive if macro or guidance disappointed later.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Quarter</th>
                    <th>Sentiment</th>
                    <th>Label</th>
                    <th>Source</th>
                    <th>Price (day 0)</th>
                    <th>Return 7d</th>
                    <th>Return 14d</th>
                    <th>Return 21d</th>
                    <th>Return 30d</th>
                  </tr>
                </thead>
                <tbody>
                  {transcripts.map((t, i) => (
                    <tr key={i}>
                      <td>{t.date ?? '—'}</td>
                      <td>{t.quarter || '—'}</td>
                      <td>{t.sentiment_score.toFixed(3)}</td>
                      <td className={`sentiment-${t.sentiment_label}`}>{t.sentiment_label}</td>
                      <td><span className="analysis-badge">{t.analysis_source === 'claude' ? 'Claude' : 'VADER'}</span></td>
                      <td>{t.price_0d != null ? `$${t.price_0d}` : '—'}</td>
                      <td className={t.return_7d_pct != null && t.return_7d_pct >= 0 ? 'return-positive' : 'return-negative'}>
                        {formatPct(t.return_7d_pct)}
                      </td>
                      <td className={t.return_14d_pct != null && t.return_14d_pct >= 0 ? 'return-positive' : 'return-negative'}>
                        {formatPct(t.return_14d_pct)}
                      </td>
                      <td className={t.return_21d_pct != null && t.return_21d_pct >= 0 ? 'return-positive' : 'return-negative'}>
                        {formatPct(t.return_21d_pct)}
                      </td>
                      <td className={t.return_30d_pct != null && t.return_30d_pct >= 0 ? 'return-positive' : 'return-negative'}>
                        {formatPct(t.return_30d_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Language analysis (Claude) per call */}
          {transcripts.some((t) => t.analysis_source === 'claude') && (
            <div className="card">
              <h2>Language analysis (Claude)</h2>
              <p className="card-desc">Tone, confidence, forward-looking language, risks, and themes from each earnings call.</p>
              {transcripts.map((t, i) => {
                if (t.analysis_source !== 'claude' || (!t.tone && !t.key_themes?.length)) return null;
                return (
                  <div key={i} className="language-block">
                    <h3>{t.quarter || t.date ?? 'Call'}</h3>
                    {t.tone && <p><strong>Tone:</strong> {t.tone}</p>}
                    <div className="meta-row">
                      {t.confidence_level && <span>Confidence: {t.confidence_level}</span>}
                      {t.forward_looking_strength && <span>Forward-looking: {t.forward_looking_strength}</span>}
                    </div>
                    {t.key_themes && t.key_themes.length > 0 && (
                      <div>
                        <strong>Key themes:</strong>
                        <ul>{t.key_themes.map((s, j) => <li key={j}>{s}</li>)}</ul>
                      </div>
                    )}
                    {t.risk_caution_notes && t.risk_caution_notes.length > 0 && (
                      <div>
                        <strong>Risks / caution:</strong>
                        <ul>{t.risk_caution_notes.map((s, j) => <li key={j}>{s}</li>)}</ul>
                      </div>
                    )}
                    {t.notable_quotes && t.notable_quotes.length > 0 && (
                      <div className="quotes">
                        <strong>Notable quotes:</strong>
                        <ul>{t.notable_quotes.map((q, j) => <li key={j} className="quote">"{q}"</li>)}</ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Drivers & future outlook per call */}
          {transcripts.some((t) => (t.drivers?.length ?? 0) > 0 || t.future_outlook_snippet) && (
            <div className="card">
              <h2>Drivers and future outlook</h2>
              <p className="card-desc">Topics management cited (positive or negative) and forward-looking language from each call. Text is cleaned from transcript extraction.</p>
              {transcripts.map((t, i) => (
                <div key={i} className="language-block">
                  <h3>{t.quarter || t.date ?? 'Call'}</h3>
                  {t.driver_summary && t.driver_summary.length > 0 && (
                    <div className="driver-tags">
                      {t.driver_summary.map((s, j) => (
                        <span key={j} className="driver-tag">{s}</span>
                      ))}
                    </div>
                  )}
                  {t.drivers && t.drivers.length > 0 && (
                    <div className="drivers-list">
                      <strong>Drivers:</strong>
                      <ul>
                        {t.drivers.slice(0, 8).map((d, j) => (
                          <li key={j} className={`driver-impact-${d.impact}`}>
                            <strong>{d.driver}</strong> ({d.impact})
                            {d.snippet && <span className="driver-snippet"> — {d.snippet.slice(0, 120)}{d.snippet.length > 120 ? '…' : ''}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {t.future_outlook_snippet && (
                    <div>
                      <strong>Future outlook:</strong>
                      <p className="outlook-snippet">{t.future_outlook_snippet}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Outlook language (full snippet) */}
          {transcripts.some((t) => t.outlook_snippet) && (
            <div className="card">
              <h2>Outlook language used for sentiment</h2>
              <p className="card-desc">Excerpt of guidance and outlook text from each call (cleaned).</p>
              {transcripts.map((t, i) =>
                t.outlook_snippet ? (
                  <div key={i} className="language-block">
                    <h3>{t.quarter || t.date ?? 'Call'}</h3>
                    <p className="outlook-snippet">{t.outlook_snippet}</p>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Scatter: Sentiment vs 7d return */}
          {scatter7.length >= 1 && (
            <div className="card">
              <h2>Management tone vs stock return (7 days)</h2>
              <p className="card-desc">Each point = one call. X = sentiment from the call (−1 to +1). Y = actual stock return in the next 7 trading days. Lower-right = sounded positive but stock fell; upper-left = sounded negative but stock rose.</p>
              {scatter7.length < 2 && <p className="card-desc">Add more transcripts to see a trend.</p>}
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Tone"
                      domain={scatter7.length >= 2 ? sentimentDomain(scatter7) : [-1, 1]}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)' }}
                      label={{ value: 'Management tone (from call)', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Return"
                      domain={scatter7.length >= 1 ? returnDomain(scatter7) : undefined}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)' }}
                      label={{ value: 'Stock return % (next 7d)', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      labelStyle={{ color: 'var(--text)' }}
                      formatter={(value: number) => [typeof value === 'number' && Math.abs(value) <= 1 ? value.toFixed(3) : `${value}%`, Math.abs(value) <= 1 ? 'Sentiment' : 'Return %']}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.name}
                    />
                    <Scatter data={scatter7} fill="var(--accent)" name="Call" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Scatter: Sentiment vs 30d return */}
          {scatter30.length >= 1 && (
            <div className="card">
              <h2>Management tone vs stock return (30 days)</h2>
              <p className="card-desc">Same as above but return over 30 trading days after the call.</p>
              {scatter30.length < 2 && <p className="card-desc">Add more transcripts to see a trend.</p>}
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Tone"
                      domain={scatter30.length >= 2 ? sentimentDomain(scatter30) : [-1, 1]}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)' }}
                      label={{ value: 'Management tone (from call)', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Return"
                      domain={scatter30.length >= 1 ? returnDomain(scatter30) : undefined}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)' }}
                      label={{ value: 'Stock return % (next 30d)', angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      formatter={(value: number) => [typeof value === 'number' && Math.abs(value) <= 1 ? value.toFixed(3) : `${value}%`, Math.abs(value) <= 1 ? 'Sentiment' : 'Return %']}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.name}
                    />
                    <Scatter data={scatter30} fill="var(--accent)" name="Call" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bar: Outlook sentiment by call */}
          {sentimentBarData.length > 0 && (
            <div className="card">
              <h2>Management tone score by call</h2>
              <p className="card-desc">Sentiment from each call (−1 = cautious/negative on outlook, +1 = confident/positive). Does not equal stock performance.</p>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sentimentBarData} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      domain={[-1, 1]}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)' }}
                      tickFormatter={(v) => v.toFixed(1)}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      formatter={(value: number) => [value.toFixed(3), 'Sentiment']}
                    />
                    <Bar dataKey="sentiment" fill="var(--accent)" name="Sentiment" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bar: Returns by call */}
          {returnsBarData.length > 0 && (
            <div className="card">
              <h2>Actual stock return after each call</h2>
              <p className="card-desc">Percentage return over the next 7, 14, 21, and 30 trading days. This is what happened in the market, not management tone.</p>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={returnsBarData} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)' }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      formatter={(value: number, name: string) => [value != null ? `${value}%` : '—', name.replace('return_', '').replace('d', 'd ')]}
                    />
                    <Legend />
                    <Bar dataKey="return_7d" fill="var(--positive)" name="7d" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="return_14d" fill="#3b82f6" name="14d" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="return_21d" fill="var(--neutral)" name="21d" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="return_30d" fill="#a78bfa" name="30d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      <p className="subtitle" style={{ marginTop: '2rem' }}>
        Generated {data.generated_at}. Sentiment reflects management tone from the call; stock return reflects what actually happened. Add transcripts to <code>data/transcripts/</code>, then run <code>npm run process</code>.
      </p>
    </div>
  );
}
