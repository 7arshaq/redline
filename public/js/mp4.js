// Just enough MP4 to make YouTube / X audio skippable on an iPhone.
//
// Audio saved straight from those sites is a *fragmented* MP4 (DASH / HLS): the sound is
// cut into hundreds of pieces with no index. Safari plays such a file but can't jump
// around in it. defragment() rewrites it as a plain MP4 with a normal index in front —
// the audio bytes are untouched, only the container changes (nothing is re-encoded).

const str4 = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

function boxes(dv, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = str4(dv, o + 4);
    let head = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = Number(dv.getBigUint64(o + 8));
      head = 16;
    } else if (size === 0) size = end - o;
    if (size < head) break;
    // A box that runs past the end (cut-off download) is still listed, clipped to what exists.
    out.push({ type, start: o, head, body: o + head, end: Math.min(end, o + size), whole: o + size <= end });
    o += size;
  }
  return out;
}
const child = (dv, box, type) => boxes(dv, box.body, box.end).find((b) => b.type === type) || null;
const path = (dv, box, ...types) => types.reduce((b, t) => (b ? child(dv, b, t) : null), box);

/** Quick look at the start of a file: is it MP4, is it fragmented, how long is it? */
export function inspect(buffer) {
  const dv = new DataView(buffer);
  const n = buffer.byteLength;
  if (n < 16) return { mp4: false };
  const first = str4(dv, 4);
  if (first !== 'ftyp' && first !== 'styp' && first !== 'moov') return { mp4: false };
  const top = boxes(dv, 0, n);
  const moov = top.find((b) => b.type === 'moov' && b.whole);
  const info = { mp4: true, fragmented: top.some((b) => b.type === 'moof'), duration: 0, moov: Boolean(moov) };
  if (moov) {
    if (child(dv, moov, 'mvex')) info.fragmented = true;
    const mvhd = child(dv, moov, 'mvhd');
    if (mvhd) {
      const v1 = dv.getUint8(mvhd.body) === 1;
      const ts = dv.getUint32(mvhd.body + (v1 ? 20 : 12));
      const dur = v1 ? Number(dv.getBigUint64(mvhd.body + 24)) : dv.getUint32(mvhd.body + 16);
      if (ts && dur && dur !== 0xffffffff) info.duration = dur / ts;
    }
  }
  return info;
}

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function box(type, ...payloads) {
  const body = concat(payloads);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

/** A "full box" table: version/flags + 32-bit words. */
function table(type, words) {
  const out = new Uint8Array(12 + words.length * 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  for (let i = 0; i < words.length; i++) dv.setUint32(12 + i * 4, words[i]);
  return out;
}

/**
 * @param {ArrayBuffer} buffer a whole fragmented MP4 holding an audio track
 * @returns {{parts: Uint8Array[], size: number, duration: number, samples: number} | null}
 *          parts for `new Blob(parts, {type: 'audio/mp4'})`, or null when the file isn't
 *          fragmented or isn't something this understands (then it's left alone).
 */
export function defragment(buffer) {
  try {
    return rebuild(buffer);
  } catch {
    return null;
  }
}

function rebuild(buffer) {
  const dv = new DataView(buffer);
  const n = buffer.byteLength;
  if (n < 64) return null;
  const top = boxes(dv, 0, n);
  const moov = top.find((b) => b.type === 'moov' && b.whole);
  const moofs = top.filter((b) => b.type === 'moof' && b.whole);
  if (!moov || !moofs.length) return null;

  // The audio track.
  let track = null;
  for (const trak of boxes(dv, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const tkhd = child(dv, trak, 'tkhd');
    const mdia = child(dv, trak, 'mdia');
    const mdhd = mdia && child(dv, mdia, 'mdhd');
    const hdlr = mdia && child(dv, mdia, 'hdlr');
    const minf = mdia && child(dv, mdia, 'minf');
    const stbl = minf && child(dv, minf, 'stbl');
    const stsd = stbl && child(dv, stbl, 'stsd');
    if (!tkhd || !mdhd || !hdlr || !stsd) continue;
    if (str4(dv, hdlr.body + 8) !== 'soun') continue;
    const tv1 = dv.getUint8(tkhd.body) === 1;
    const mv1 = dv.getUint8(mdhd.body) === 1;
    track = {
      trak,
      tkhd,
      mdia,
      mdhd,
      hdlr,
      minf,
      stsd,
      id: dv.getUint32(tkhd.body + (tv1 ? 20 : 12)),
      timescale: dv.getUint32(mdhd.body + (mv1 ? 20 : 12)),
      codec: str4(dv, stsd.body + 12),
    };
    break;
  }
  if (!track || !track.timescale) return null;

  // Per-track defaults for fragments.
  let defDur = 0;
  let defSize = 0;
  let defDesc = 1;
  const mvex = child(dv, moov, 'mvex');
  if (mvex) {
    for (const trex of boxes(dv, mvex.body, mvex.end).filter((b) => b.type === 'trex')) {
      if (dv.getUint32(trex.body + 4) !== track.id) continue;
      defDesc = dv.getUint32(trex.body + 8) || 1;
      defDur = dv.getUint32(trex.body + 12);
      defSize = dv.getUint32(trex.body + 16);
    }
  }

  // Walk every fragment and collect where each audio sample lives.
  const sizes = [];
  const durs = [];
  const runs = []; // contiguous byte ranges of audio data, in play order
  let clock = 0; // running decode time, in track timescale
  let desc = null;
  let cut = false;

  scan: for (const moof of moofs) {
    let lastEnd = moof.start;
    let firstTraf = true;
    for (const traf of boxes(dv, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const kids = boxes(dv, traf.body, traf.end);
      const tfhd = kids.find((k) => k.type === 'tfhd');
      if (!tfhd) continue;
      const tf = dv.getUint32(tfhd.body) & 0xffffff;
      let p = tfhd.body + 4;
      const trackId = dv.getUint32(p);
      p += 4;
      let base = null;
      if (tf & 0x1) {
        base = Number(dv.getBigUint64(p));
        p += 8;
      }
      let sd = defDesc;
      if (tf & 0x2) {
        sd = dv.getUint32(p);
        p += 4;
      }
      let dDur = defDur;
      let dSize = defSize;
      if (tf & 0x8) {
        dDur = dv.getUint32(p);
        p += 4;
      }
      if (tf & 0x10) {
        dSize = dv.getUint32(p);
        p += 4;
      }
      if (base === null) base = tf & 0x20000 || firstTraf ? moof.start : lastEnd;
      firstTraf = false;
      const mine = trackId === track.id;

      if (mine) {
        if (desc === null) desc = sd;
        else if (desc !== sd) return null; // mixed formats in one track: leave the file alone
        const tfdt = kids.find((k) => k.type === 'tfdt');
        if (tfdt && durs.length) {
          const t0 = dv.getUint8(tfdt.body) === 1 ? Number(dv.getBigUint64(tfdt.body + 4)) : dv.getUint32(tfdt.body + 4);
          const gap = t0 - clock;
          // A hole in the timeline: stretch the previous sample over it so times stay true.
          if (gap > 0 && gap < track.timescale * 3600) {
            durs[durs.length - 1] += gap;
            clock += gap;
          }
        }
      }

      let next = null;
      for (const trun of kids.filter((k) => k.type === 'trun')) {
        const rf = dv.getUint32(trun.body) & 0xffffff;
        let q = trun.body + 4;
        const count = dv.getUint32(q);
        q += 4;
        let pos = next ?? base;
        if (rf & 0x1) {
          pos = base + dv.getInt32(q);
          q += 4;
        }
        if (rf & 0x4) q += 4;
        const hasDur = rf & 0x100;
        const hasSize = rf & 0x200;
        const skip = (rf & 0x400 ? 4 : 0) + (rf & 0x800 ? 4 : 0);
        const per = (hasDur ? 4 : 0) + (hasSize ? 4 : 0) + skip;
        if (q + count * per > trun.end) return null;
        const runStart = pos;
        let taken = 0;
        for (let i = 0; i < count; i++) {
          let d = dDur;
          let s = dSize;
          if (hasDur) {
            d = dv.getUint32(q);
            q += 4;
          }
          if (hasSize) {
            s = dv.getUint32(q);
            q += 4;
          }
          q += skip;
          if (mine) {
            if (pos + s > n) {
              cut = true; // the download stopped early: keep what is whole
              break;
            }
            sizes.push(s);
            durs.push(d);
            clock += d;
            taken++;
          }
          pos += s;
        }
        if (mine && taken && pos > runStart) {
          const last = runs[runs.length - 1];
          if (last && last.end === runStart) last.end = pos;
          else runs.push({ start: runStart, end: pos });
        }
        next = pos;
        lastEnd = pos;
        if (cut) break scan;
      }
    }
  }

  const count = sizes.length;
  if (!count) return null;
  let total = 0;
  for (let i = 0; i < count; i++) total += durs[i];
  let dataSize = 0;
  for (const r of runs) dataSize += r.end - r.start;

  // ── sample tables ──
  const stts = [];
  for (let i = 0; i < count; ) {
    let j = i + 1;
    while (j < count && durs[j] === durs[i]) j++;
    stts.push(j - i, durs[i]);
    i = j;
  }
  // About half a second of audio per chunk, like files made by Apple's own tools.
  const typical = durs[Math.min(count - 1, 1)] || 1024;
  const perChunk = Math.max(1, Math.min(count, Math.round((track.timescale * 0.5) / typical)));
  const chunks = Math.ceil(count / perChunk);
  const tail = count - (chunks - 1) * perChunk;
  const stsc = chunks > 1 && tail !== perChunk ? [1, perChunk, desc || 1, chunks, tail, desc || 1] : [1, Math.min(perChunk, count), desc || 1];

  const sttsBox = table('stts', [stts.length / 2, ...stts]);
  const stscBox = table('stsc', [stsc.length / 3, ...stsc]);
  const stszBox = new Uint8Array(20 + count * 4);
  {
    const v = new DataView(stszBox.buffer);
    v.setUint32(0, stszBox.length);
    stszBox.set([0x73, 0x74, 0x73, 0x7a], 4); // 'stsz'
    v.setUint32(16, count);
    for (let i = 0; i < count; i++) v.setUint32(20 + i * 4, sizes[i]);
  }

  // Durations in the copied headers.
  const mvhdSrc = child(dv, moov, 'mvhd');
  if (!mvhdSrc) return null;
  const copy = (b) => new Uint8Array(buffer.slice(b.start, b.end));
  const mvhd = copy(mvhdSrc);
  const tkhd = copy(track.tkhd);
  const mdhd = copy(track.mdhd);
  const setDur = (bytes, v1, off, value) => {
    const v = new DataView(bytes.buffer);
    if (v1) v.setBigUint64(off, BigInt(Math.round(value)));
    else v.setUint32(off, Math.min(0xffffffff, Math.round(value)));
  };
  const mv1 = mvhd[8] === 1;
  const movieScale = new DataView(mvhd.buffer).getUint32(mv1 ? 28 : 20) || 1000;
  setDur(mvhd, mv1, mv1 ? 32 : 24, (total * movieScale) / track.timescale);
  const tv1 = tkhd[8] === 1;
  setDur(tkhd, tv1, tv1 ? 36 : 28, (total * movieScale) / track.timescale);
  tkhd[11] |= 0x07; // enabled, in movie, in preview
  const dv1 = mdhd[8] === 1;
  setDur(mdhd, dv1, dv1 ? 32 : 24, total);

  const ftyp =
    track.codec === 'mp4a'
      ? box('ftyp', new Uint8Array([0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d])) // M4A · mp42 · isom
      : box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32])); // isom · mp42

  const minfKeep = boxes(dv, track.minf.body, track.minf.end)
    .filter((b) => b.type !== 'stbl')
    .map(copy);

  // Chunk offsets depend on how big the header is, and the header's size doesn't depend on
  // the offsets' values — so build once with zeros, measure, then fill them in.
  const build = (offsets, wide) => {
    const co = wide ? new Uint8Array(16 + chunks * 8) : new Uint8Array(16 + chunks * 4);
    const v = new DataView(co.buffer);
    v.setUint32(0, co.length);
    co.set(wide ? [0x63, 0x6f, 0x36, 0x34] : [0x73, 0x74, 0x63, 0x6f], 4); // 'co64' / 'stco'
    v.setUint32(12, chunks);
    for (let i = 0; i < chunks; i++) {
      if (wide) v.setBigUint64(16 + i * 8, BigInt(offsets[i]));
      else v.setUint32(16 + i * 4, offsets[i]);
    }
    const stbl = box('stbl', copy(track.stsd), sttsBox, stscBox, stszBox, co);
    const minf = box('minf', ...minfKeep, stbl);
    const mdia = box('mdia', mdhd, copy(track.hdlr), minf);
    return box('moov', mvhd, box('trak', tkhd, mdia));
  };

  const rel = new Array(chunks);
  {
    let o = 0;
    for (let i = 0, c = 0; i < count; i++) {
      if (i % perChunk === 0) rel[c++] = o;
      o += sizes[i];
    }
  }
  const bigData = dataSize + 16 > 0xffffffff;
  const mdatHead = bigData ? 16 : 8;
  let wide = false;
  let moovOut = build(rel, wide);
  if (ftyp.length + moovOut.length + mdatHead + dataSize > 0xffffffff) {
    wide = true;
    moovOut = build(rel, wide);
  }
  const first = ftyp.length + moovOut.length + mdatHead;
  moovOut = build(
    rel.map((o) => o + first),
    wide,
  );

  const mdat = new Uint8Array(mdatHead);
  {
    const v = new DataView(mdat.buffer);
    if (bigData) {
      v.setUint32(0, 1);
      v.setBigUint64(8, BigInt(dataSize + 16));
    } else v.setUint32(0, dataSize + 8);
    mdat.set([0x6d, 0x64, 0x61, 0x74], 4); // 'mdat'
  }

  const head = concat([ftyp, moovOut, mdat]);
  const parts = [head, ...runs.map((r) => new Uint8Array(buffer, r.start, r.end - r.start))];
  return { parts, size: head.length + dataSize, duration: total / track.timescale, samples: count, cut };
}
