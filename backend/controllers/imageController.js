import sharp from 'sharp';
import fs from 'fs';
import { tonePresets } from '../tonePresets.js';

export const processImage = async (req, res) => {
  const tone = req.body.tone || 'light-filled';
  const toneAliases = {
    'bright': 'bright-fresh',
    'fresh': 'bright-fresh',
    'dusk': 'moody',
    'moody-dusk': 'moody',
  };
  
  const resolvedTone = toneAliases[tone] || tone;
  const preset = tonePresets[resolvedTone] || tonePresets['light-filled'];

  if (!req.file?.path) {
    return res.status(400).json({ error: 'Missing image file (field name: image)' });
  }

  try {
    const MAX_DIM = 2560;

    let base = sharp(req.file.path)
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: MAX_DIM,
        height: MAX_DIM,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .normalise();

    if (preset.rgb) {
      base = base.linear(preset.rgb, [0, 0, 0]);
    }

    const { data: baseBuf, info } = await base
      .modulate({ brightness: preset.brightness, saturation: preset.saturation })
      .gamma(Math.max(1.0, preset.gamma ?? 1.0))
      .linear(preset.contrast, 0)
      .sharpen(1.0)
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });

    const composites = [];

    if (preset.overlay) {
      const { r, g, b, alpha } = preset.overlay.color;
      const overlayBuf = await sharp({
        create: {
          width: info.width,
          height: info.height,
          channels: 4,
          background: { r, g, b, alpha },
        },
      }).png().toBuffer();

      composites.push({ input: overlayBuf, blend: preset.overlay.blend });
    }

    if (preset.vignette) {
      const strength = Math.max(0, Math.min(1, preset.vignette));
      const vignetteSvg = `
<svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="v" cx="50%" cy="50%" r="65%">
      <stop offset="55%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,${strength})" />
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="100%" height="100%" fill="url(#v)"/>
</svg>`;

      composites.push({ input: Buffer.from(vignetteSvg), blend: 'multiply' });
    }

    let out = sharp(baseBuf);
    if (composites.length) out = out.composite(composites);

    const processed = await out
      .jpeg({ quality: 88, progressive: true, mozjpeg: true })
      .toBuffer();

    // ✅ Send response
    res.set('Content-Type', 'image/jpeg');
    res.send(processed);
  } catch (err) {
    console.error('Image processing error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // ✅ Always cleanup temp file
    try { fs.unlinkSync(req.file.path); } catch {}
  }
};
