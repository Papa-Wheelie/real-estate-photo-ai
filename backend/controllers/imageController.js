import sharp from "sharp";
import fs from "fs";
import path from "path";
import archiver from "archiver";

import { tonePresets } from "../tonePresets.js";
import { titanInpaint } from "../src/services/bedrockImage.js";
import { pickTitanSize } from "../src/utils/titanSizes.js";



function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}


function quantileFromHist(hist, total, q) {
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i / 255;
  }
  return 1;
}

// Compute median luminance + p95 luminance on a downscaled copy
async function analyseLuma(inputPath) {
  const analysis = await sharp(inputPath)
    .rotate()
    .toColourspace("srgb")
    .resize({ width: 1024, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = analysis;
  const channels = info.channels;

  const totalPx = info.width * info.height;
  const stride = Math.max(1, Math.floor(totalPx / 250_000));

  const hist = new Uint32Array(256);
  for (let p = 0; p < totalPx; p += stride) {
    const i = p * channels;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const y = Math.max(0, Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b));
    hist[(y * 255) | 0]++;
  }

  const total = hist.reduce((a, b) => a + b, 0);

  const p25 = quantileFromHist(hist, total, 0.25);
  const median = quantileFromHist(hist, total, 0.50);
  const p95 = quantileFromHist(hist, total, 0.95);
  const p98 = quantileFromHist(hist, total, 0.98);

  // ✅ NEW scoring (better for interiors)
  const shadowScore = Math.max(0, Math.min(1, (0.35 - p25) / 0.35));      // uses p25
  const highlightScore = Math.max(0, Math.min(1, (p98 - 0.90) / 0.10));   // uses p98

  return { p25Luma: p25, medianLuma: median, p95Luma: p95, p98Luma: p98, shadowScore, highlightScore };
}

// Apply adaptive scaling for bright-fresh only
function adaptBrightFresh(preset, analysis) {
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const s = analysis.shadowScore;      // 0..1 (darker → higher)
  const h = analysis.highlightScore;   // 0..1 (hot highlights → higher)

  // NEW: detect already-bright scenes (facade case)
  const brightScore = clamp01((analysis.medianLuma - 0.55) / 0.25); // 0..1

  const caps = preset.caps || {};
  const baseOverlayAlpha = preset.overlay?.color?.alpha ?? 0;

  // Brightness: lift dark scenes, back off on already bright scenes
  const brightness = clamp(
    preset.brightness + 0.04 * s - 0.08 * brightScore,
    preset.brightness,                         // never darker than base preset
    caps.brightnessMax ?? 1.28
  );

  // Gamma: lift shadows without washing highlights (pool + interior)
  const gamma = clamp(
    (preset.gamma ?? 1.0) + 0.22 * s + 0.05 * h,
    1.0,
    1.25
  );

  // Contrast: slightly up for dark images, slightly down for hot highlights
  const contrast = clamp(
    preset.contrast + 0.03 * s - 0.04 * h,
    1.0,
    caps.contrastMax ?? 1.10
  );

  // Overlay: helps "fresh" look, but causes grass wash/yellowing if too strong
  let overlay = preset.overlay;
  if (overlay?.color?.alpha != null) {
    const alpha = clamp(
      baseOverlayAlpha + 0.02 * s - 0.10 * brightScore - 0.03 * h,
      0,
      caps.overlayAlphaMax ?? 0.26
    );
    overlay = { ...overlay, color: { ...overlay.color, alpha } };
  }

  // Saturation: don’t desaturate dark images too much (prevents yellowish grass wash)
  const saturation = clamp(
    preset.saturation + 0.02 * s - 0.02 * brightScore,
    caps.saturationMin ?? 0.98,
    caps.saturationMax ?? 1.06
  );

  return { ...preset, brightness, gamma, contrast, saturation, overlay };
}


function resolveTonePreset(rawTone) {
  const tone = String(rawTone || "bright-fresh").trim().toLowerCase();

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
  return { resolvedTone, preset };
}

function safeBaseName(originalName = "image") {
  const base = path.parse(originalName).name || "image";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Deterministic pipeline: identical to your current processImage flow
 * but returns a buffer + info instead of writing to res.
 */
async function renderDeterministicJpeg(inputPath, preset, { maxDim = 2560 } = {}) {
  let base = sharp(inputPath)
    .rotate()
    .toColourspace("srgb")
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .normalise();

  if (preset.rgb) base = base.linear(preset.rgb, [0, 0, 0]);

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
    })
      .png()
      .toBuffer();

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
    composites.push({ input: Buffer.from(vignetteSvg), blend: "multiply" });
  }

  let out = sharp(baseBuf);
  if (composites.length) out = out.composite(composites);

  const processed = await out
    .jpeg({ quality: 88, progressive: true, mozjpeg: true })
    .toBuffer();

  return { processed, info };
}




// Stage 1: Bright & Fresh (deterministic) wrapper
export const processBrightFresh = async (req, res) => {
  req.body = req.body || {};
  req.body.tone = "bright-fresh";
  return processImage(req, res);
};


// Legacy deterministic endpoint (now using helper)
export const processImage = async (req, res) => {
  const debug = req.query.debug === "1";
  const { resolvedTone, preset } = resolveTonePreset(req.body.tone);

  if (!req.file?.path) {
    return res.status(400).json({ error: "Missing image file (field name: image)" });
  }

  try {
    const { processed, info } = await renderDeterministicJpeg(req.file.path, preset, {
      maxDim: 2560,
    });

    if (debug) {
      return res.json({
        tone: resolvedTone,
        width: info.width,
        height: info.height,
        preset,
        bytes: processed.length,
      });
    }

    res.set("Content-Type", "image/jpeg");
    return res.send(processed);
  } catch (err) {
    console.error("Image processing error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(req.file.path);
    } catch {}
  }
};

export const processBrightFreshBatch = async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: "Missing image files (field name: images)" });
  }

  // Force preset to bright-fresh
  const { preset } = resolveTonePreset("bright-fresh");

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="bright-fresh.zip"');

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => {
    console.error("ZIP error:", err);
    try {
      if (!res.headersSent) res.status(500);
      res.end();
    } catch {}
  });

  archive.pipe(res);

  // Process sequentially to keep memory stable
  for (const f of files) {
    try {
      const { processed } = await renderDeterministicJpeg(f.path, preset, { maxDim: 2560 });
      const base = safeBaseName(f.originalname);
      archive.append(processed, { name: `${base}-bright-fresh.jpg` });
    } catch (err) {
      // include an error txt inside the zip rather than failing the whole batch
      const base = safeBaseName(f.originalname);
      archive.append(String(err?.message || err), { name: `${base}-ERROR.txt` });
    } finally {
      try {
        fs.unlinkSync(f.path);
      } catch {}
    }
  }

  await archive.finalize();
};

// function clamp(n, min, max) {
//   return Math.max(min, Math.min(max, n));
// }

function parseAspect(aspect) {
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

// Build STRICT binary mask from alpha channel:
// alpha 0 (transparent padding) => 0 (inpaint)
// alpha 255 (real image)        => 255 (keep)
async function buildAlphaMaskPngStrict(rgbaPngBuf) {
  return sharp(rgbaPngBuf)
    .ensureAlpha()
    .extractChannel(3) // alpha
    // threshold at 254 -> alpha 255 becomes 255, everything else becomes 0
    .threshold(254)
    .png()
    .toBuffer();
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

  const MAX_DIM = Number(req.body.maxDim ?? 2560);
  const straighten = clamp(Number(req.body.straighten ?? -0.4), -5, 5);
  const vertical = clamp(Number(req.body.vertical ?? 0.03), -0.25, 0.25);
  const aspect = parseAspect(req.body.aspect ?? "4:3");

  const useAiFill = req.body.aiFillCorners === "1" || req.body.aiFillCorners === "true";
  const cfgScale = Number(req.body.cfgScale ?? 1.8); // keep low to reduce “reimagining”
  const finalWidth = Number(req.body.finalWidth ?? 1600);
  const finalAspect = aspect ?? 4 / 3;
  const finalHeight = Math.round(finalWidth / finalAspect);

  try {
    // Phase A: grade
    let img = sharp(req.file.path)
      .rotate()
      .toColourspace("srgb")
      .resize({
        width: MAX_DIM,
        height: MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .normalise();

    if (preset.rgb) img = img.linear(preset.rgb, [0, 0, 0]);

    img = img
      .modulate({ brightness: preset.brightness, saturation: preset.saturation })
      .gamma(Math.max(1.0, preset.gamma ?? 1.0))
      .linear(preset.contrast, 0)
      .sharpen(1.0);

    if (Math.abs(straighten) > 0.001) {
      img = img.rotate(straighten, { background: { r: 0, g: 0, b: 0, alpha: 1 } });
    }

    if (Math.abs(vertical) > 0.0001) {
      img = img.affine(
        [
          [1, vertical],
          [0, 1],
        ],
        { background: { r: 0, g: 0, b: 0, alpha: 1 } }
      );
    }

    // Materialise
    let out = sharp((await img.jpeg({ quality: 92 }).toBuffer()));

    // Crop to aspect
    out = await cropToAspect(out, aspect);

    // Re-materialise so overlay sizing is exact
    const { data: croppedBuf, info: croppedInfo } = await out
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });

    out = sharp(croppedBuf);

    const outW = croppedInfo.width;
    const outH = croppedInfo.height;
    if (!outW || !outH) throw new Error("Could not determine output dimensions");

    const composites = [];

    if (preset.overlay) {
      const { r, g, b, alpha } = preset.overlay.color;
      const overlayBuf = await sharp({
        create: { width: outW, height: outH, channels: 4, background: { r, g, b, alpha } },
      })
        .png()
        .toBuffer();
      composites.push({ input: overlayBuf, blend: preset.overlay.blend });
    }

    if (preset.vignette) {
      const strength = Math.max(0, Math.min(1, preset.vignette));
      const vignetteSvg = `
<svg width="${outW}" height="${outH}" xmlns="http://www.w3.org/2000/svg">
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

    if (!useAiFill) {
      const processed = await out.jpeg({ quality: 88, progressive: true, mozjpeg: true }).toBuffer();
      res.set("Content-Type", "image/jpeg");
      return res.send(processed);
    }

    // ---------- AI fill corners (alpha-mask approach) ----------
    const finalRgbaPng = await out.ensureAlpha().png().toBuffer();
    const meta = await sharp(finalRgbaPng).metadata();
    if (!meta.width || !meta.height) throw new Error("Could not read output dimensions");

    // IMPORTANT: pickTitanSize in your utils should return { width, height }
    const { w: titanW, h: titanH } = pickTitanSize(meta.width, meta.height);
    if (!titanW || !titanH) throw new Error(`pickTitanSize failed: ${meta.width}x${meta.height}`);

    console.log("Titan size:", meta.width, meta.height, "=>", titanW, titanH);


    // Pad to Titan size USING TRANSPARENCY (alpha=0) so mask is perfect
    const bedrockInputRgba = await sharp(finalRgbaPng)
      .ensureAlpha()
      .resize(titanW, titanH, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent padding
      })
      .png()
      .toBuffer();

    const maskPng = await buildAlphaMaskPngStrict(bedrockInputRgba);

    // Flatten image to RGB for Titan input (mask still targets padded regions)
    const bedrockInput = await sharp(bedrockInputRgba)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .png()
      .toBuffer();

    // Debug dumps (optional)
    const debugDir = path.resolve(process.cwd(), "uploads", "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    await sharp(bedrockInputRgba).toFile(path.join(debugDir, "_debug-bedrockInput.png"));
    await sharp(maskPng).toFile(path.join(debugDir, "_debug-mask.png"));

    const resp = await titanInpaint({
      imageBase64: bedrockInput.toString("base64"),
      maskBase64: maskPng.toString("base64"),
      width: titanW,
      height: titanH,
      cfgScale,
      text:
        "Extend the existing photo ONLY into the masked border area. " +
        "Do not alter the unmasked image. Match texture, lines, and lighting seamlessly.",
      negativeText:
        "text, watermark, logo, people, cars, new objects, redesign, geometry change, " +
        "different windows, different roof, colour shift, blur, painterly",
    });

    const b64 = resp?.images?.[0];
    if (!b64) throw new Error("Bedrock returned no images[]");

    const outBytes = Buffer.from(b64, "base64");

    // Final: crop/scale to listing-friendly dimensions
    const processed = await sharp(outBytes)
      .resize(finalWidth, finalHeight, { fit: "cover" })
      .jpeg({ quality: 90, progressive: true, mozjpeg: true })
      .toBuffer();

    res.set("Content-Type", "image/jpeg");
    return res.send(processed);
  } catch (err) {
    console.error("Pro processing error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    try {
      fs.unlinkSync(req.file.path);
    } catch {}
  }
};
