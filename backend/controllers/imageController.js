import sharp from 'sharp';
import fs from 'fs';
import { tonePresets } from '../tonePresets.js';
// import { invokeTitanImageVariation } from "../src/services/bedrockImage.js";


// export const aiVariation = async (req, res) => {
//   const tone = req.body.tone || "bright-fresh";

//   // Keep prompts conservative at first so it doesn’t “rebuild” materials.
//   const tonePrompts = {
//     "bright-fresh":
//       "Professional real estate listing photo. Bright and airy. Clean white balance. Natural colours. Subtle clarity. No HDR halos. Photorealistic.",
//     moody:
//       "Professional real estate listing photo with late-afternoon dusk mood. Slightly cooler shadows, warm highlights. Cinematic but realistic. Preserve materials. Photorealistic.",
//     "warm-sunset":
//       "Professional real estate listing photo with warm golden-hour tone. Warm highlights, gentle contrast, natural colours. Photorealistic.",
//     "light-filled":
//       "Professional real estate listing photo. Light-filled interior/exterior look. Neutral whites. Natural colours. Photorealistic.",
//     natural:
//       "Professional real estate listing photo. Neutral colour. True-to-life. Subtle clarity. Photorealistic.",
//   };

//   const text = tonePrompts[tone] || tonePrompts["bright-fresh"];
//   const negativeText =
//     "cartoon, illustration, painting, anime, unrealistic, overprocessed, extreme HDR, halos, artifacts, text, watermark";

//   if (!req.file?.path) {
//     return res.status(400).json({ error: "Missing image file (field name: image)" });
//   }

//   try {
//     const MODEL_ID = process.env.BEDROCK_IMAGE_MODEL_ID || "amazon.titan-image-generator-v2:0";

//     // Titan has input-size limits; keep longest side <= 1408 for these tasks. :contentReference[oaicite:4]{index=4}
//     const inputBuf = await sharp(req.file.path)
//       .rotate()
//       .resize({ width: 1408, height: 1408, fit: "inside", withoutEnlargement: true })
//       .jpeg({ quality: 92 })
//       .toBuffer();

//     const b64 = inputBuf.toString("base64");

//     // IMAGE_VARIATION request shape is documented here. :contentReference[oaicite:5]{index=5}
//     const body = {
//       taskType: "IMAGE_VARIATION",
//       imageVariationParams: {
//         images: [b64],
//         text,
//         negativeText,
//         similarityStrength: Number(req.body.similarityStrength ?? 0.88), // 0.2..1.0 :contentReference[oaicite:6]{index=6}
//       },
//       imageGenerationConfig: {
//         numberOfImages: 1,
//         quality: "standard",
//         cfgScale: Number(req.body.cfgScale ?? 7),
//         // width/height optional for variation; you can set it later if you want.
//       },
//     };

//     const out = await invokeTitanImageVariation({ modelId: MODEL_ID, body });

//     if (out?.error) {
//       return res.status(502).json({ error: out.error });
//     }

//     // Titan returns base64 images[0]. :contentReference[oaicite:7]{index=7}
//     const outBytes = Buffer.from(out.images[0], "base64");

//     res.set("Content-Type", "image/jpeg");
//     return res.send(outBytes);
//   } catch (err) {
//     console.error("Bedrock variation error:", err);
//     return res.status(500).json({ error: err.message });
//   } finally {
//     try { fs.unlinkSync(req.file.path); } catch { }
//   }
// };


export const processImage = async (req, res) => {
  const debug = req.query.debug === '1';
  const tone = String(req.body.tone || 'light-filled').trim().toLowerCase();
  const toneAliases = {
    bright: 'bright-fresh',
    fresh: 'bright-fresh',
    sunset: 'warm-sunset',
    warm: 'warm-sunset',
    dusk: 'moody',
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

    if (debug) {
      return res.json({
        tone: resolvedTone ?? tone,
        width: info.width,
        height: info.height,
        preset,
        bytes: processed.length,
      });
    }

    // ✅ Send response
    res.set('Content-Type', 'image/jpeg');
    res.send(processed);
  } catch (err) {
    console.error('Image processing error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // ✅ Always cleanup temp file
    try { fs.unlinkSync(req.file.path); } catch { }
  }
};


function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseAspect(aspect) {
  // Accept "4:3", "3:2", "16:9", "1:1"
  if (!aspect) return null;
  const [a, b] = String(aspect).split(":").map(Number);
  if (!a || !b) return null;
  return a / b;
}

async function cropToAspect(img, aspectRatio) {
  if (!aspectRatio) return img;

  const meta = await img.metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) return img;

  const current = w / h;

  // If too wide, crop sides. If too tall, crop top/bottom.
  if (current > aspectRatio) {
    const newW = Math.round(h * aspectRatio);
    const left = Math.round((w - newW) / 2);
    return img.extract({ left, top: 0, width: newW, height: h });
  } else if (current < aspectRatio) {
    const newH = Math.round(w / aspectRatio);
    const top = Math.round((h - newH) / 2);
    return img.extract({ left: 0, top, width: w, height: newH });
  }

  return img;
}

export const processPro = async (req, res) => {
  const tone = String(req.body.tone || "bright-fresh").trim().toLowerCase();

  const toneAliases = {
    bright: "bright-fresh",
    fresh: "bright-fresh",
    sunset: "warm-sunset",
    warm: "warm-sunset",
    dusk: "moody",
    "moody-dusk": "moody",
  };

  const resolvedTone = toneAliases[tone] || tone;
  const preset = tonePresets[resolvedTone] || tonePresets["light-filled"];

  if (!req.file?.path) {
    return res.status(400).json({ error: "Missing image file (field name: image)" });
  }

  // Controls (all deterministic)
  const MAX_DIM = Number(req.body.maxDim ?? 2560);

  // small straighten: degrees between -5..5
  const straighten = clamp(Number(req.body.straighten ?? -0.4), -5, 5);

  // vertical shear approx: -0.25..0.25 (tiny values like 0.06)
  const vertical  = clamp(Number(req.body.vertical  ?? 0.03), -0.25, 0.25);

  // aspect crop like "4:3"
  const aspect = parseAspect(req.body.aspect ?? "4:3");

  try {
    // Phase A: base quality + grade
    let img = sharp(req.file.path)
      .rotate() // EXIF orientation
      .toColourspace("srgb")
      .resize({
        width: MAX_DIM,
        height: MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .normalise();

    if (preset.rgb) {
      img = img.linear(preset.rgb, [0, 0, 0]);
    }

    img = img
      .modulate({ brightness: preset.brightness, saturation: preset.saturation })
      .gamma(Math.max(1.0, preset.gamma ?? 1.0))
      .linear(preset.contrast, 0)
      .sharpen(1.0);

    // Straighten (adds triangles; we’ll later fill or smarter-crop)
    if (Math.abs(straighten) > 0.001) {
      img = img.rotate(straighten, { background: { r: 0, g: 0, b: 0, alpha: 1 } });
    }

    // Vertical correction (approx via affine shear)
    // x' = x + k*y  (shear X by Y)
    if (Math.abs(vertical) > 0.0001) {
      img = img.affine(
        [
          [1, vertical],
          [0, 1],
        ],
        { background: { r: 0, g: 0, b: 0, alpha: 1 } }
      );
    }

    // Phase B: overlays (your existing approach)
    const { data: baseBuf, info } = await img
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });

    let out = sharp(baseBuf);

    // 1) Apply crop first
    out = await cropToAspect(out, aspect);

    // 2) ✅ Materialise the cropped image so its dimensions are guaranteed
    const { data: croppedBuf, info: croppedInfo } = await out
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });

    // Re-wrap as a new Sharp instance (now “fixed” dimensions)
    out = sharp(croppedBuf);      

    const W = croppedInfo.width;
    const H = croppedInfo.height;
    if (!W || !H) throw new Error("Could not determine output dimensions for compositing");

    // 3) Build overlays at EXACT final size
    const composites = [];

    if (preset.overlay) {
      const { r, g, b, alpha } = preset.overlay.color;
      const overlayBuf = await sharp({
        create: { width: W, height: H, channels: 4, background: { r, g, b, alpha } },
      }).png().toBuffer();
    
      composites.push({ input: overlayBuf, blend: preset.overlay.blend });
    }

    if (preset.vignette) {
      const strength = Math.max(0, Math.min(1, preset.vignette));
      const vignetteSvg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="v" cx="50%" cy="50%" r="65%">
          <stop offset="55%" stop-color="rgba(0,0,0,0)" />
          <stop offset="100%" stop-color="rgba(0,0,0,${strength})" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="url(#v)"/>
    </svg>`;
      composites.push({ input: Buffer.from(vignetteSvg), blend: "multiply" });
    }

    if (composites.length) out = out.composite(composites); 

    // 4) Output
    const processed = await out
      .jpeg({ quality: 88, progressive: true, mozjpeg: true })
      .toBuffer();

    res.set("Content-Type", "image/jpeg");
    return res.send(processed);
  } catch (err) {
    console.error("Pro processing error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(req.file.path);
    } catch { }
  }
};

