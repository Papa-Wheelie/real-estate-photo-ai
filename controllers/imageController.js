import sharp from 'sharp';
import fs from 'fs';
import { tonePresets } from '../tonePresets.js';

export const processImage = async (req, res) => {
  const tone = req.body.tone || 'light-filled';
  const settings = tonePresets[tone] || tonePresets['light-filled'];

  try {
    const processed = await sharp(req.file.path)
      .modulate({
        brightness: settings.brightness,
        saturation: settings.saturation,
      })
      .linear(settings.contrast, 0)
      .jpeg()
      .toBuffer();

    fs.unlinkSync(req.file.path); // clean temp file

    res.set('Content-Type', 'image/jpeg');
    res.send(processed);
  } catch (err) {
    console.error('Image processing error:', err);
    res.status(500).json({ error: 'Failed to process image' });
  }
};
