/**
 * Chart colour tokens.
 *
 * Series hues are the first three slots of the validated categorical palette,
 * assigned in fixed order and never cycled. Verified against this product's
 * actual chart surface (#ffffff) under both the adjacent and all-pairs
 * pairlists: lightness band, chroma floor, CVD separation (worst ΔE 9.2
 * deuteranopia), and the normal-vision floor (worst ΔE 24.0) all pass.
 *
 * The aqua slot sits at 2.82:1 against white, below the 3:1 mark threshold.
 * That WARN is not dismissable — it obligates a relief channel — so every
 * chart using these series also ships the same figures as a table (the
 * Sentiment Trend panel) and direct end-of-line labels. Do not use these hues
 * without one of those.
 *
 * Chrome is deliberately recessive and drawn from the product's own design
 * tokens so charts sit inside the institutional palette rather than beside it.
 */

export const SERIES = {
  overall: '#2a78d6',
  management: '#eb6834',
  qa: '#1baf7a',
} as const;

export const CHROME = {
  grid: '#e3e0da',
  axis: '#cfcbc3',
  label: '#8a857c',
  surface: '#ffffff',
  ink: '#1a1917',
} as const;

export const SERIES_LABELS = {
  overall: 'Overall',
  management: 'Management',
  qa: 'Q&A',
} as const;
