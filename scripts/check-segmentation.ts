/**
 * Development check for the transcript segmenter.
 *
 * Segmentation is heuristic and fails quietly — a bad speaker regex produces
 * plausible-looking output with the wrong attribution. This prints the shape
 * of the parse for every fixture so regressions are visible.
 *
 * Usage: npx tsx scripts/check-segmentation.ts
 */

import transcripts from '../lib/providers/fixtures/data/transcripts.json';
import { segmentTranscript, findQuoteOffset } from '../lib/transcript/segment';
import type { SpeakerRole } from '../lib/types';

let failures = 0;

function expect(label: string, condition: boolean, detail: string) {
  if (!condition) {
    failures += 1;
    console.log(`    FAIL  ${label}: ${detail}`);
  }
}

for (const t of transcripts) {
  const seg = segmentTranscript(t.text);
  const byRole = new Map<SpeakerRole, number>();
  for (const turn of seg.turns) {
    byRole.set(turn.role, (byRole.get(turn.role) ?? 0) + 1);
  }

  const prepChars = seg.preparedRemarks.reduce((n, x) => n + x.text.length, 0);
  const qaChars = seg.qa.reduce((n, x) => n + x.text.length, 0);

  console.log(`\n${t.ticker} Q${t.fiscalQuarter} FY${t.fiscalYear}  (${t.text.length} chars)`);
  console.log(`  turns=${seg.turns.length}  boundary=${seg.boundaryDetected}  speakers=${seg.speakersIdentified}`);
  console.log(`  roles: ${[...byRole].map(([r, n]) => `${r}=${n}`).join(' ')}`);
  console.log(`  prepared=${prepChars} chars (${seg.preparedRemarks.length} turns), qa=${qaChars} chars (${seg.qa.length} turns)`);

  const speakers = [...new Set(seg.turns.map((x) => `${x.speaker}[${x.role}]`))];
  console.log(`  cast: ${speakers.slice(0, 10).join(', ')}`);

  // Offsets must round-trip: slicing the original by a turn's range must
  // reproduce that turn's opening words.
  const sample = seg.turns.find((x) => x.text.length > 120);
  if (sample) {
    const sliced = t.text.slice(sample.charStart, sample.charEnd);
    expect('offset round-trip', sliced.includes(sample.text.slice(0, 60)),
      `turn ${sample.index} text not found at [${sample.charStart},${sample.charEnd}]`);

    const quote = sample.text.slice(20, 120);
    expect('quote anchoring', findQuoteOffset(t.text, quote) !== null,
      'a verbatim excerpt could not be located');
  }

  expect('Q&A boundary found', seg.boundaryDetected, 'no prepared/Q&A split detected');
  expect('has prepared remarks', prepChars > 2000, `only ${prepChars} chars`);
  expect('has Q&A', qaChars > 2000, `only ${qaChars} chars`);
  expect('CEO identified', (byRole.get('ceo') ?? 0) > 0, 'no CEO turns');
  expect('CFO identified', (byRole.get('cfo') ?? 0) > 0, 'no CFO turns');
  expect('analysts identified', (byRole.get('analyst') ?? 0) > 0, 'no analyst turns');
  expect('few unknowns', (byRole.get('unknown') ?? 0) <= 2,
    `${byRole.get('unknown')} unattributed turns`);
}

console.log(failures === 0 ? '\nAll segmentation checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
