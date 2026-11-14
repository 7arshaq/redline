// Geometric stroke icons, 24px grid, drawn to sit with the bento tiles.
const F = 'fill="currentColor" stroke="none"';
const P = {
  play: `<path ${F} d="M7.2 4.3v15.4c0 .75.82 1.2 1.45.8l12.2-7.7a.95.95 0 0 0 0-1.6L8.65 3.5c-.63-.4-1.45.05-1.45.8z"/>`,
  pause: `<rect ${F} x="5.4" y="4" width="4.8" height="16" rx="1.3"/><rect ${F} x="13.8" y="4" width="4.8" height="16" rx="1.3"/>`,
  next: `<path ${F} d="M4.5 5.3v13.4c0 .7.77 1.13 1.37.75l10.5-6.7a.9.9 0 0 0 0-1.5L5.87 4.55c-.6-.38-1.37.05-1.37.75z"/><rect ${F} x="17.2" y="4.6" width="3" height="14.8" rx="1.1"/>`,
  prev: `<path ${F} d="M19.5 5.3v13.4c0 .7-.77 1.13-1.37.75L7.63 12.75a.9.9 0 0 1 0-1.5l10.5-6.7c.6-.38 1.37.05 1.37.75z"/><rect ${F} x="3.8" y="4.6" width="3" height="14.8" rx="1.1"/>`,
  back: '<path d="M3.6 12.3A8.4 8.4 0 1 0 6.2 6"/><path d="M3.4 3.2v4.6H8"/>',
  fwd: '<path d="M20.4 12.3A8.4 8.4 0 1 1 17.8 6"/><path d="M20.6 3.2v4.6H16"/>',
  'chev-down': '<path d="M5.5 9l6.5 6.5L18.5 9"/>',
  'chev-right': '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  more: `<circle ${F} cx="5" cy="12" r="1.9"/><circle ${F} cx="12" cy="12" r="1.9"/><circle ${F} cx="19" cy="12" r="1.9"/>`,
  star: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/>',
  'star-fill': `<path ${F} d="M12 2.4l2.95 6.03 6.65.92-4.85 4.6 1.2 6.6L12 17.3l-5.95 3.25 1.2-6.6L2.4 9.35l6.65-.92z"/>`,
  share: '<path d="M12 14.5V3.5"/><path d="M7.5 7.8L12 3.3l4.5 4.5"/><path d="M5 11.5v7.3c0 .95.75 1.7 1.7 1.7h10.6c.95 0 1.7-.75 1.7-1.7v-7.3"/>',
  mark: '<path d="M6.5 3.5h11v17l-5.5-4.2-5.5 4.2z"/>',
  'mark-plus': '<path d="M6.5 3.5h11v17l-5.5-4.2-5.5 4.2z"/><path d="M12 7.5v5M9.5 10h5"/>',
  note: '<path d="M4 5.2c0-.94.76-1.7 1.7-1.7h12.6c.94 0 1.7.76 1.7 1.7v9.6c0 .94-.76 1.7-1.7 1.7H10l-4.5 4v-4h0c-.83 0-1.5-.67-1.5-1.5z"/><path d="M8 8.5h8M8 12h5"/>',
  queue: '<path d="M3.5 6h13M3.5 11h13M3.5 16h7"/><path d="M15 14.2v6.6l5.2-3.3z" fill="currentColor"/>',
  'play-next': '<path d="M9.5 6h11M9.5 11.5h11M9.5 17h11"/><path d="M3.2 8.6v6.8l5-3.4z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.2h5v2.3"/><path d="M6.2 6.5l.9 13.3h9.8l.9-13.3"/>',
  edit: '<path d="M4 20l1-4.6L15.6 4.8a1.9 1.9 0 0 1 2.7 0l.9.9a1.9 1.9 0 0 1 0 2.7L8.6 19z"/><path d="M13.5 7l3.5 3.5"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1-1"/>',
  clip: '<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 10h6M9 14h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/>',
  moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z"/>',
  gauge: '<path d="M4.2 17.5a8.6 8.6 0 1 1 15.6 0"/><path d="M12 13l4.2-4.2"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
  volume: '<path d="M4 9.5h3.2L12 5.2v13.6l-4.8-4.3H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.2L12 5.2v13.6l-4.8-4.3H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  'v-list': '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'v-tiles': '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/>',
  'v-compact': '<path d="M4 5h16M4 9.5h16M4 14h16M4 18.5h16" stroke-width="1.7"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  stack: '<rect x="4" y="9" width="16" height="11" rx="1.8"/><path d="M6.5 6h11M9 3h6"/>',
  focus: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  unfocus: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  grip: `<circle ${F} cx="9" cy="6.5" r="1.5"/><circle ${F} cx="15" cy="6.5" r="1.5"/><circle ${F} cx="9" cy="12" r="1.5"/><circle ${F} cx="15" cy="12" r="1.5"/><circle ${F} cx="9" cy="17.5" r="1.5"/><circle ${F} cx="15" cy="17.5" r="1.5"/>`,
  download: '<path d="M12 3.5v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20.5h14"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.3c0 .94-.76 1.7-1.7 1.7H5.7c-.94 0-1.7-.76-1.7-1.7V7.7C4 6.76 4.76 6 5.7 6H10"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5"/><path d="M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  folder: '<path d="M3.5 7.2c0-.94.76-1.7 1.7-1.7h4.3l2 2.2h7.3c.94 0 1.7.76 1.7 1.7v8.4c0 .94-.76 1.7-1.7 1.7H5.2c-.94 0-1.7-.76-1.7-1.7z"/>',
  'folder-plus': '<path d="M3.5 7.2c0-.94.76-1.7 1.7-1.7h4.3l2 2.2h7.3c.94 0 1.7.76 1.7 1.7v8.4c0 .94-.76 1.7-1.7 1.7H5.2c-.94 0-1.7-.76-1.7-1.7z"/><path d="M12 10.5v5M9.5 13h5"/>',
  phone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4"/><path d="M10.5 18h3"/>',
  dots: `<circle ${F} cx="12" cy="5" r="1.9"/><circle ${F} cx="12" cy="12" r="1.9"/><circle ${F} cx="12" cy="19" r="1.9"/>`,
  'ios-share': '<path d="M12 14V3.5"/><path d="M8 7.3l4-4 4 4"/><path d="M8.5 10.5H6.7c-.94 0-1.7.76-1.7 1.7v7.1c0 .94.76 1.7 1.7 1.7h10.6c.94 0 1.7-.76 1.7-1.7v-7.1c0-.94-.76-1.7-1.7-1.7h-1.8"/>',
  'add-box': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>',
  install: '<path d="M12 3.5v10"/><path d="M8 9.8l4 4 4-4"/><rect x="4" y="16.5" width="16" height="4" rx="1.4"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5V8h4.5"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="1.6"/><rect x="4" y="13" width="16" height="7" rx="1.6"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
};

export function sprite() {
  const symbols = Object.entries(P)
    .map(
      ([k, v]) =>
        `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${v}</symbol>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg>`;
}

export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// The flared "tulip" arrow from the bento reference. Points up; rotate for other directions.
export const tulip = (cls = '') =>
  `<svg class="tulip ${cls}" viewBox="0 0 100 120" aria-hidden="true"><path d="M50 116V18" /><path d="M9 58C29 50 44 36 50 11" /><path d="M91 58C71 50 56 36 50 11" /></svg>`;
