import type { Config } from 'tailwindcss';

/**
 * Institutional research aesthetic: off-white ground, thin hairline borders,
 * compact type, restrained colour. Colour is reserved for data — direction,
 * sentiment, and deltas — never for decoration.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#faf9f7',
        surface: '#ffffff',
        raised: '#f4f2ef',
        line: '#e3e0da',
        'line-strong': '#cfcbc3',
        ink: '#1a1917',
        'ink-secondary': '#5c5851',
        'ink-muted': '#8a857c',
        accent: '#1c4e80',
        'accent-soft': '#eef3f8',
        positive: '#1a7f4b',
        'positive-soft': '#e9f5ee',
        negative: '#a32d2d',
        'negative-soft': '#fbeded',
        caution: '#8a6212',
        'caution-soft': '#fbf3e2',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.4rem' }],
      },
      borderRadius: {
        DEFAULT: '3px',
        sm: '2px',
        md: '4px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(26, 25, 23, 0.04)',
        pop: '0 4px 16px rgba(26, 25, 23, 0.10)',
      },
    },
  },
  plugins: [],
};

export default config;
