// Renders Redline's icons: a black record in a red tick ring, white tone-arm.
// Run from the Earmark folder (it has @resvg/resvg-js): node redline/scripts/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

function icon({ size = 512, bleed = false, square = false }) {
  const k = bleed ? 0.8 : 1;
  const c = 256;
  const R = 196 * k;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const lit = i < 40;
    const r0 = R - 22 * k;
    return `<line x1="${(c + Math.cos(a) * r0).toFixed(1)}" y1="${(c + Math.sin(a) * r0).toFixed(1)}" x2="${(c + Math.cos(a) * R).toFixed(1)}" y2="${(c + Math.sin(a) * R).toFixed(1)}" stroke="${lit ? '#ff2a37' : '#2e2e2e'}" stroke-width="${7 * k}" stroke-linecap="round"/>`;
  }).join('');
  const d = 148 * k;
  const grooves = [0.92, 0.82, 0.72, 0.62].map((f) => `<circle cx="${c}" cy="${c}" r="${(d * f).toFixed(1)}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${bleed || square ? 0 : 112}" fill="#000"/>
    ${ticks}
    <circle cx="${c}" cy="${c}" r="${d}" fill="#111" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>
    ${grooves}
    <circle cx="${c}" cy="${c}" r="${d * 0.36}" fill="#ff2a37"/>
    <circle cx="${c}" cy="${c}" r="${9 * k}" fill="#000"/>
    <g transform="translate(${c} ${c}) scale(${k}) translate(-256 -256)">
      <circle cx="370" cy="148" r="20" fill="#fff"/>
      <path d="M370 148 L366 300 L330 334" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="312" y="322" width="30" height="22" rx="5" transform="rotate(-42 327 333)" fill="#fff"/>
    </g>
  </svg>`;
}

const jobs = [
  ['icon-512.png', icon({ size: 512 })],
  ['icon-192.png', icon({ size: 192 })],
  ['maskable-512.png', icon({ size: 512, bleed: true })],
  ['apple-touch-icon.png', icon({ size: 180, square: true })],
];
for (const [name, svg] of jobs) {
  const size = Number(svg.match(/width="(\d+)"/)[1]);
  fs.writeFileSync(path.join(out, name), new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  console.log('ok', name);
}
fs.writeFileSync(path.join(out, 'icon.svg'), icon({ size: 512 }).replace(/width="512" height="512" /, ''));
