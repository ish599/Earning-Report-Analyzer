import type {
  SegmentedTranscript,
  SpeakerRole,
  TranscriptSection,
  TranscriptTurn,
} from '@/lib/types';

/**
 * Splits a raw earnings-call transcript into speaker turns, tagged by role and
 * by section (prepared remarks vs analyst Q&A).
 *
 * Why this exists: sending an undifferentiated wall of text to the model
 * conflates what management asserted with what analysts challenged. Those are
 * different signals to a research analyst, and the product scores them
 * separately.
 *
 * Two transcript conventions are supported:
 *
 *   Roster style (AlphaSense/S&P exports) — a "Call Participants" block lists
 *   executives and analysts, then each turn is `Name \n Title \n body`.
 *
 *   Inline style (FMP and most vendors) — `Speaker Name: body`, one turn per
 *   paragraph.
 *
 * All character offsets index into the *original* string so that a quote can
 * be anchored back to the transcript the user sees.
 */

// Boundary between prepared remarks and Q&A. Ordered most to least specific.
const QA_MARKERS = [
  /^\s*question[\s-]and[\s-]answer(?:\s+session)?\s*$/im,
  /^\s*questions?\s+and\s+answers?\s*$/im,
  /^\s*q\s*&\s*a(?:\s+session)?\s*$/im,
  /we(?:'ll| will) now open the (?:call|floor) (?:up )?(?:to|for) questions/i,
  /\[?operator instructions\]?/i,
];

const PRESENTATION_MARKERS = [/^\s*presentation\s*$/im, /^\s*prepared remarks\s*$/im];

const ROSTER_START = /^\s*call participants\s*$/im;
const EXEC_HEADING = /^\s*(executives|company participants|corporate participants)\s*$/im;
const ANALYST_HEADING = /^\s*(analysts|conference call participants)\s*$/im;

// Export-tool artifacts that are not spoken content.
const NOISE_PATTERNS = [
  /^page \d+ of \d+$/i,
  /^downloaded from \w+/i,
  /^copyright ©/i,
  /^\s*$/,
];

interface RosterEntry {
  name: string;
  title: string | null;
  role: SpeakerRole;
}

export function segmentTranscript(raw: string): SegmentedTranscript {
  const roster = parseRoster(raw);
  const bodyStart = findBodyStart(raw);
  const qaStart = findQaStart(raw, bodyStart);

  const turns =
    roster.length > 0
      ? splitByRoster(raw, roster, bodyStart, qaStart)
      : splitByColon(raw, bodyStart, qaStart);

  // A transcript that yields no turns is still displayable; treat the whole
  // body as one unattributed prepared-remarks turn rather than losing it.
  const resolved: TranscriptTurn[] =
    turns.length > 0
      ? turns
      : [
          {
            index: 0,
            speaker: 'Unattributed',
            role: 'unknown',
            affiliation: null,
            text: stripNoise(raw.slice(bodyStart)),
            section: 'prepared_remarks',
            charStart: bodyStart,
            charEnd: raw.length,
          },
        ];

  return {
    turns: resolved,
    preparedRemarks: resolved.filter((t) => t.section === 'prepared_remarks'),
    qa: resolved.filter((t) => t.section === 'qa'),
    boundaryDetected: qaStart !== null,
    speakersIdentified: new Set(
      resolved.filter((t) => t.role !== 'unknown').map((t) => t.speaker),
    ).size,
  };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * Reads the participant roster, which gives reliable role attribution.
 *
 * Without it, roles have to be guessed from titles appearing inline, which is
 * far noisier. Returns an empty array when there is no roster block.
 */
function parseRoster(raw: string): RosterEntry[] {
  const start = ROSTER_START.exec(raw);
  if (!start) return [];

  const bodyStart = findBodyStart(raw);
  const block = raw.slice(start.index + start[0].length, bodyStart);
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isNoise(l));

  const entries: RosterEntry[] = [];
  let inAnalysts = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (EXEC_HEADING.test(line)) {
      inAnalysts = false;
      continue;
    }
    if (ANALYST_HEADING.test(line)) {
      inAnalysts = true;
      continue;
    }
    if (!looksLikePersonName(line)) continue;

    // The following line is the title (executives) or firm (analysts), unless
    // it is itself another name or a heading.
    const next = lines[i + 1];
    const title =
      next && !looksLikePersonName(next) && !EXEC_HEADING.test(next) && !ANALYST_HEADING.test(next)
        ? next
        : null;

    entries.push({
      name: line,
      title,
      role: inAnalysts ? 'analyst' : roleFromTitle(title),
    });
    if (title) i += 1;
  }

  return entries;
}

function roleFromTitle(title: string | null): SpeakerRole {
  if (!title) return 'management';
  const t = title.toLowerCase();
  if (/\bceo\b|chief executive/.test(t)) return 'ceo';
  if (/\bcfo\b|chief financial/.test(t)) return 'cfo';
  return 'management';
}

/**
 * Job titles and firm names. These are title-cased and word-shaped exactly
 * like person names, so without an explicit exclusion "Chief Financial
 * Officer" and "Guggenheim Securities, LLC, Research Division" are both
 * mistaken for speakers — which silently reattributes the CFO's remarks.
 */
const TITLE_OR_FIRM =
  /\b(chief|officer|president|vice|chairman|chairwoman|director|division|research|securities|capital|partners|holdings|bank|banking|markets|advisors|advisers|equity|investments|investment|llc|inc|ltd|plc|lp|llp|group|management|analyst|treasurer|controller|founder|head|manager|relations|corporation|company|associates|global|international)\b/i;

/** Vendor placeholders that are legitimate speaker labels despite the wording. */
const PLACEHOLDER_SPEAKER = /^unknown\s+(executive|analyst|attendee|speaker|participant)$/i;

function looksLikeTitleOrFirm(line: string): boolean {
  if (PLACEHOLDER_SPEAKER.test(line.trim())) return false;
  return TITLE_OR_FIRM.test(line);
}

/**
 * Heuristic for "this line is a person's name, not prose or a job title".
 *
 * Names are short, title-cased, and unpunctuated at the end. Getting this
 * wrong splits a turn mid-sentence, so the test is deliberately strict.
 */
function looksLikePersonName(line: string): boolean {
  const trimmed = line.trim();
  if (PLACEHOLDER_SPEAKER.test(trimmed)) return true;

  if (trimmed.length < 3 || trimmed.length > 60) return false;
  if (/[.!?,:;]$/.test(trimmed)) return false;
  if (/\d/.test(trimmed)) return false;
  if (looksLikeTitleOrFirm(trimmed)) return false;

  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;

  // Every word starts uppercase; allows initials (G.) and particles (van, de).
  return words.every((w) => /^[A-Z]/.test(w) || /^(van|de|der|von|del|la|di|el)$/i.test(w));
}

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

function findBodyStart(raw: string): number {
  for (const marker of PRESENTATION_MARKERS) {
    const match = marker.exec(raw);
    if (match) return match.index + match[0].length;
  }
  return 0;
}

/** Index at which analyst Q&A begins, or null when no boundary is present. */
function findQaStart(raw: string, after: number): number | null {
  const scope = raw.slice(after);
  for (const marker of QA_MARKERS) {
    const match = marker.exec(scope);
    if (match) return after + match.index;
  }
  return null;
}

function sectionFor(offset: number, qaStart: number | null): TranscriptSection {
  return qaStart !== null && offset >= qaStart ? 'qa' : 'prepared_remarks';
}

// ---------------------------------------------------------------------------
// Turn splitting
// ---------------------------------------------------------------------------

interface TurnMark {
  name: string;
  role: SpeakerRole;
  affiliation: string | null;
  /** Offset of the speaker heading itself, used for section assignment. */
  start: number;
  /** Offset at which spoken content begins. */
  bodyStart: number;
}

/**
 * Splits on speaker headings that occupy their own line.
 *
 * A heading is recognised three ways, in priority order: the literal
 * "Operator"; a name listed in the participant roster; or a name-shaped line
 * immediately followed by a title-shaped line. The third case matters because
 * transcripts routinely feature speakers absent from the roster — the investor
 * relations lead who opens the call, for instance — and without it their
 * remarks are silently absorbed into the previous speaker's turn.
 */
function splitByRoster(
  raw: string,
  roster: RosterEntry[],
  bodyStart: number,
  qaStart: number | null,
): TranscriptTurn[] {
  const byName = new Map(roster.map((r) => [r.name.toLowerCase(), r]));
  const lines = indexLines(raw, bodyStart);
  const marks: TurnMark[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const { text: line, start, end } = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.toLowerCase() === 'operator') {
      marks.push({ name: 'Operator', role: 'operator', affiliation: null, start, bodyStart: end });
      continue;
    }

    const rosterEntry = byName.get(trimmed.toLowerCase());
    if (rosterEntry) {
      // Consume the title line when it repeats the roster title; otherwise it
      // is spoken content and must stay in the body.
      const next = lines[i + 1];
      const consumeTitle =
        next != null &&
        rosterEntry.title != null &&
        next.text.trim() === rosterEntry.title;

      marks.push({
        name: rosterEntry.name,
        role: rosterEntry.role,
        affiliation: rosterEntry.role === 'analyst' ? rosterEntry.title : null,
        start,
        bodyStart: consumeTitle ? next.end : end,
      });
      if (consumeTitle) i += 1;
      continue;
    }

    // Off-roster speaker: name line followed by a title or firm line.
    const next = lines[i + 1];
    if (next && looksLikePersonName(trimmed) && looksLikeTitleOrFirm(next.text.trim())) {
      const title = next.text.trim();
      const role = roleFromTitle(title);
      marks.push({
        name: trimmed,
        role,
        affiliation: role === 'analyst' ? title : null,
        start,
        bodyStart: next.end,
      });
      i += 1;
    }
  }

  return marksToTurns(raw, marks, qaStart);
}

function marksToTurns(raw: string, marks: TurnMark[], qaStart: number | null): TranscriptTurn[] {
  return marks
    .map((mark, i): TranscriptTurn => {
      const end = i + 1 < marks.length ? marks[i + 1].start : raw.length;
      return {
        index: i,
        speaker: mark.name,
        role: mark.role,
        affiliation: mark.affiliation,
        text: stripNoise(raw.slice(mark.bodyStart, end)),
        section: sectionFor(mark.start, qaStart),
        charStart: mark.bodyStart,
        charEnd: end,
      };
    })
    .filter((t) => t.text.length > 0)
    .map((turn, i) => ({ ...turn, index: i }));
}

interface IndexedLine {
  text: string;
  start: number;
  /** Offset just past the line's newline, i.e. where the next line begins. */
  end: number;
}

function indexLines(raw: string, from: number): IndexedLine[] {
  const lines: IndexedLine[] = [];
  let cursor = from;

  while (cursor < raw.length) {
    const newline = raw.indexOf('\n', cursor);
    const stop = newline === -1 ? raw.length : newline;
    lines.push({ text: raw.slice(cursor, stop), start: cursor, end: stop + 1 });
    if (newline === -1) break;
    cursor = newline + 1;
  }

  return lines;
}

/** `Speaker Name: body` convention used by most transcript APIs. */
function splitByColon(raw: string, bodyStart: number, qaStart: number | null): TranscriptTurn[] {
  const pattern = /^[ \t]*([A-Z][A-Za-z.'\- ]{1,60}?)\s*:[ \t]*/gm;
  pattern.lastIndex = bodyStart;

  const marks: { name: string; start: number; bodyStart: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].trim();
    // Reject prose that happens to contain a colon ("One note: ...").
    if (name.split(/\s+/).length > 6) continue;
    marks.push({ name, start: match.index, bodyStart: match.index + match[0].length });
  }

  const roles = inferRolesFromNames(marks.map((m) => m.name));

  return marks
    .map((mark, i): TranscriptTurn => {
      const end = i + 1 < marks.length ? marks[i + 1].start : raw.length;
      return {
        index: i,
        speaker: mark.name,
        role: roles.get(mark.name) ?? 'unknown',
        affiliation: null,
        text: stripNoise(raw.slice(mark.bodyStart, end)),
        section: sectionFor(mark.start, qaStart),
        charStart: mark.bodyStart,
        charEnd: end,
      };
    })
    .filter((t) => t.text.length > 0);
}

/**
 * Role inference when no roster is available.
 *
 * Titles are often embedded in the speaker label itself ("Tim Cook - CEO").
 * Anything unrecognized stays 'unknown' rather than being guessed as
 * management, because mislabeling an analyst's scepticism as management
 * commentary would corrupt the management-vs-Q&A scores.
 */
function inferRolesFromNames(names: string[]): Map<string, SpeakerRole> {
  const out = new Map<string, SpeakerRole>();

  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower === 'operator') {
      out.set(name, 'operator');
    } else if (/\bceo\b|chief executive|chairman/.test(lower)) {
      out.set(name, 'ceo');
    } else if (/\bcfo\b|chief financial/.test(lower)) {
      out.set(name, 'cfo');
    } else if (/analyst|research/.test(lower)) {
      out.set(name, 'analyst');
    } else {
      out.set(name, 'unknown');
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(line.trim()));
}

function stripNoise(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isNoise(line))
    .join('\n')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Quote anchoring
// ---------------------------------------------------------------------------

/**
 * Locates a quote within the transcript, tolerating whitespace differences.
 *
 * Returns the character offset in `raw`, or null when the quote cannot be
 * found. Null is meaningful: it means the model did not reproduce the excerpt
 * verbatim, and the caller drops the quote rather than presenting an
 * unverifiable one as management's words.
 */
export function findQuoteOffset(raw: string, quote: string): number | null {
  const needle = quote.trim();
  if (needle.length < 12) return null;

  const direct = raw.indexOf(needle);
  if (direct !== -1) return direct;

  // Retry ignoring whitespace runs, which differ between the model's echo of
  // the text and the stored original.
  const normalized = needle.replace(/\s+/g, ' ');
  const pattern = new RegExp(
    normalized.split(' ').map(escapeRegex).join('\\s+'),
    'i',
  );
  const match = pattern.exec(raw);
  return match ? match.index : null;
}

/**
 * True when the excerpt genuinely appears in the transcript.
 *
 * This is the guard against fabricated quotes: anything the model returns that
 * fails this check is discarded before it is stored or displayed.
 */
export function quoteExistsInTranscript(raw: string, quote: string): boolean {
  return findQuoteOffset(raw, quote) !== null;
}
