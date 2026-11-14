// Lock-screen artwork: a black record with a red tick ring, drawn on the fly.
const cache = new Map();

function wrap(g, text, maxW, maxLines) {
  const lines = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width <= maxW) line = test;
    else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

export function artworkFor(t) {
  const key = `${t.id}|${t.title}`;
  if (cache.has(key)) return cache.get(key);
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);

  // tick ring, top right, two thirds lit
  const cx = 372;
  const cy = 150;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = i < 46 ? '#ff2a37' : '#2b2b2b';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
    g.lineTo(cx + Math.cos(a) * 110, cy + Math.sin(a) * 110);
    g.stroke();
  }
  g.fillStyle = '#0d0d0d';
  g.beginPath();
  g.arc(cx, cy, 78, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.12)';
  g.lineWidth = 1.5;
  for (const r of [70, 60, 50, 40]) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#ff2a37';
  g.beginPath();
  g.arc(cx, cy, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(cx, cy, 5, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#ff2a37';
  g.beginPath();
  g.arc(48, 60, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '800 22px -apple-system, "Helvetica Neue", "Segoe UI", sans-serif';
  g.fillText('R E D L I N E', 68, 68);

  g.font = '800 50px -apple-system, "Helvetica Neue", "Segoe UI", sans-serif';
  const lines = wrap(g, t.title || 'Audio', S - 88, 3);
  let y = 468 - (lines.length - 1) * 54;
  for (const l of lines) {
    g.fillText(l, 44, y);
    y += 54;
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
