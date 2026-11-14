// Turns noisy video titles into short, calm, still-relevant names.
// "Rick Astley - Never Gonna Give You Up (Official Music Video) [4K]"  ->  "Never Gonna Give You Up"
// "Andrew Huberman: The Science of Sleep — Huberman Lab Podcast #2"    ->  "The Science of Sleep"

const MAX = 44;

const NOISE = [
  'official', 'video', 'audio', 'lyrics?', 'lyric video', 'hd', 'hq', '4k', '8k', '1080p', '720p', '60fps',
  'full', 'full episode', 'full interview', 'full video', 'full movie', 'episode', 'ep\\.?', 'podcast', 'clip', 'clips',
  'live', 'remaster(?:ed)?', 'visuali[sz]er', 'm/?v', 'subtitles?', 'subs?', 'eng(?:lish)?', 'cc', 'new', 'free',
  'update[sd]?', 'must watch', 'watch', 'shorts?', 'reupload', 'extended', 'uncut', 'explained', 'reaction',
  'trailer', 'teaser', 'version', 'edit', 'sped up', 'slowed', 'reverb', 'bass boosted', 'nightcore', 'part \\d+',
  'pt\\.? ?\\d+', '(?:19|20)\\d\\d', 'feat\\.?', 'ft\\.?', 'prod\\.?', 'mix', 'highlights?',
];
const NOISE_RE = new RegExp(`\\b(?:${NOISE.join('|')})\\b`, 'i');
const SHOW_RE = /\b(podcast|show|experience|radio|ep(?:isode)?\.?\s*#?\d+|#\s?\d+|vol\.?\s*\d+|s\d+\s*e\d+)\b/i;
const STOP_TAIL = /\s+(?:a|an|the|of|and|or|to|in|on|for|with|at|by|from|vs\.?|&|is|are|was|my|your|our|their|its|this|that|how|why|what|when)$/i;
const BRACKETS = /[\(\[【「『〔{]([^\)\]】」』〕}]*)[\)\]】」』〕}]/g;

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

function clean(s) {
  return String(s || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍|[\u{1F1E6}-\u{1F1FF}]/gu, ' ')
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/([!?.])\1+/g, '$1')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBrackets(s) {
  const stripped = s.replace(BRACKETS, (m, inner) => (NOISE_RE.test(inner) || inner.trim().length < 2 ? ' ' : m));
  // If what remains is still long, drop every bracket group (they're almost always noise).
  const out = stripped.replace(/\s+/g, ' ').trim();
  if (out.replace(BRACKETS, '').trim().length >= 12 && out.length > MAX) return out.replace(BRACKETS, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

function deShout(s) {
  const letters = s.replace(/[^\p{L}]/gu, '');
  const upper = s.replace(/[^\p{Lu}]/gu, '');
  if (letters.length < 6 || upper.length / letters.length < 0.65) return s;
  const small = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'vs']);
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase())))
    .join(' ')
    .replace(/\b(ai|ceo|usa|uk|nba|nfl|ufc|gpt|ui|ux|api|tv|dj|mma|f1|pc)\b/gi, (m) => m.toUpperCase());
}

function cap(s, max = MAX) {
  s = s.replace(/^[\s\-–—|:•·,;]+|[\s\-–—|:•·,;]+$/g, '').trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max + 1);
  const sp = cut.lastIndexOf(' ');
  cut = sp > max * 0.5 ? cut.slice(0, sp) : s.slice(0, max);
  let prev;
  do {
    prev = cut;
    cut = cut.replace(STOP_TAIL, '').replace(/[\s\-–—|:•·,;'"(\[]+$/g, '');
  } while (cut !== prev);
  return cut.trim();
}

function firstSentence(text) {
  const parts = text.split(/(?<=[.!?])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
  let out = parts[0] || '';
  if (out.length < 14 && parts[1]) out = `${out} ${parts[1]}`;
  return out.replace(/[.]+$/, '');
}

export function shortTitle(meta = {}) {
  const title = meta.title || meta.fulltitle || '';
  const owners = [meta.uploader, meta.channel, meta.creator].filter(Boolean).map(norm).filter((o) => o.length > 2);
  const extractor = String(meta.extractor_key || meta.extractor || '');
  const isSocialPost = /twitter|^x$|threads|instagram|tiktok|facebook|reddit|bluesky/i.test(extractor);

  // Social posts: the "title" is usually "Name - first words…", the real text is in the description.
  if (isSocialPost) {
    let text = meta.description || title.replace(/^[^-]{1,60}\s-\s/, '');
    text = clean(text.replace(/(^|\s)@\w+/g, ' '));
    const s = cap(deShout(firstSentence(text)));
    if (s.length >= 3) return s;
    return cap(meta.uploader ? `${meta.uploader} clip` : 'Saved clip');
  }

  let t = deShout(stripBrackets(clean(title)));

  const segments = t
    .split(/\s+[|•·–—\-~]\s+|\s*\|\s*|\s*\/\/\s*|:\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const isOwner = (seg) => {
    const n = norm(seg);
    return n.length > 2 && owners.some((o) => o === n || (n.length > 5 && (o.includes(n) || n.includes(o))));
  };

  let keep = segments.filter((s) => !isOwner(s) && !(SHOW_RE.test(s) && segments.length > 1) && !(NOISE_RE.test(s) && s.split(' ').length <= 3 && segments.length > 1));
  if (!keep.length) keep = segments.filter((s) => !isOwner(s));
  if (!keep.length) keep = segments;

  // Prefer the most informative segment: most words, but don't reward run-on sentences.
  const score = (s) => {
    const words = s.split(' ').length;
    return Math.min(words, 9) - Math.max(0, s.length - 60) / 12;
  };
  let best = keep.reduce((a, b) => (score(b) > score(a) ? b : a), keep[0] || t);

  // A lone name ("Elon Musk") with a meaningful sibling segment reads better joined.
  if (best.split(' ').length <= 2 && keep.length > 1) {
    const other = keep.find((s) => s !== best && s.length + best.length + 3 <= MAX);
    if (other) best = keep.indexOf(other) < keep.indexOf(best) ? `${other}: ${best}` : `${best}: ${other}`;
  }

  const out = cap(best);
  return out.length >= 2 ? out : cap(clean(title)) || 'Untitled audio';
}
