const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const REPO = '/Users/moorthy/Downloads/Projects/Data&AI Hackathon/parallax';
const OUT = path.join(__dirname, 'assets');

(async () => {
  // 1. Transparent banner: strip background rects, rasterize at 2x
  let svg = fs.readFileSync(path.join(REPO, 'docs/assets/banner.svg'), 'utf8');
  svg = svg.replace(/<!-- background -->[\s\S]*?<!-- wordmark -->/, '<!-- wordmark -->');
  // make sure nothing else paints a full-size rect
  svg = svg.replace(/<rect width="1600" height="500"[^>]*\/>\s*/g, '');
  fs.writeFileSync(path.join(OUT, 'banner-transparent.svg'), svg);
  const SCALE = 2;
  const full = await sharp(Buffer.from(svg), { density: 72 * SCALE }).png().toBuffer();
  const meta = await sharp(full).metadata();
  console.log('banner raster', meta.width, meta.height);
  // wordmark crop (1x coords: x 80..575, y 105..255)
  await sharp(full).extract({ left: 80 * SCALE, top: 105 * SCALE, width: 495 * SCALE, height: 150 * SCALE })
    .png().toFile(path.join(OUT, 'wordmark.png'));
  // fork art crop (1x coords: x 820..1600, y 20..480)
  await sharp(full).extract({ left: 820 * SCALE, top: 20 * SCALE, width: 780 * SCALE, height: 460 * SCALE })
    .png().toFile(path.join(OUT, 'forkart.png'));
  // sponsor pills crop (1x coords: x 90..680, y 366..408)
  await sharp(full).extract({ left: 90 * SCALE, top: 366 * SCALE, width: 590 * SCALE, height: 42 * SCALE })
    .png().toFile(path.join(OUT, 'pills.png'));

  // 2. Slide background 1920x1080: base #07090f + soft glows
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <radialGradient id="a" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#6366f1" stop-opacity="0.22"/>
        <stop offset="0.6" stop-color="#6366f1" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="b" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#22d3ee" stop-opacity="0.16"/>
        <stop offset="0.6" stop-color="#22d3ee" stop-opacity="0.04"/>
        <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M48 0H0V48" fill="none" stroke="#e6e9f2" stroke-opacity="0.028" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="1920" height="1080" fill="#07090f"/>
    <rect width="1920" height="1080" fill="url(#grid)"/>
    <ellipse cx="-80" cy="-60" rx="900" ry="620" fill="url(#a)"/>
    <ellipse cx="2000" cy="1140" rx="980" ry="640" fill="url(#b)"/>
  </svg>`;
  await sharp(Buffer.from(bg)).png().toFile(path.join(OUT, 'bg.png'));
  // title variant with a stronger glow
  const bgTitle = bg.replace('stop-opacity="0.22"', 'stop-opacity="0.34"').replace('stop-opacity="0.16"', 'stop-opacity="0.26"');
  await sharp(Buffer.from(bgTitle)).png().toFile(path.join(OUT, 'bg-title.png'));

  // 3. Memory screenshot crop: header through the first memory card (y 80..730)
  await sharp(path.join(REPO, 'docs/assets/screenshots/memory.png'))
    .extract({ left: 160, top: 80, width: 1280, height: 650 }).png().toFile(path.join(OUT, 'memory-crop.png'));
  // 4. Mission control screenshot: full (keep) and Launch hero crop for slide 2 (optional)
  await sharp(path.join(REPO, 'docs/assets/screenshots/launch.png'))
    .extract({ left: 160, top: 800, width: 1280, height: 200 }).png().toFile(path.join(OUT, 'launch-datasets-crop.png'));
  // 5. History crop: table region
  await sharp(path.join(REPO, 'docs/assets/screenshots/history.png'))
    .extract({ left: 180, top: 225, width: 1240, height: 270 }).png().toFile(path.join(OUT, 'history-crop.png'));
  for (const f of fs.readdirSync(OUT)) {
    if (!f.endsWith('.png')) continue;
    const m = await sharp(path.join(OUT, f)).metadata();
    console.log(f, m.width, m.height, m.hasAlpha ? 'alpha' : 'opaque');
  }
})().catch(e => { console.error(e); process.exit(1); });
