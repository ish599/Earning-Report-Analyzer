import { normalizeRoicLatestPayload } from '@/lib/providers/roicTranscripts';

const payload = {
  symbol: 'AAPL',
  year: 2026,
  quarter: 3,
  date: '2026-07-30T00:00:00.000Z',
  content: 'Example earnings call transcript...',
};

try {
  const normalized = normalizeRoicLatestPayload(payload);
  console.log('normalized', JSON.stringify(normalized, null, 2));
  process.exit(0);
} catch (error) {
  console.error('validation failed', error);
  process.exit(1);
}
