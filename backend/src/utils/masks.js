import sharp from "sharp";

// Mask must be ONLY 0 or 255
// 0 = inpaint, 255 = keep
export async function buildBlackCornerMaskPng(imageBuf, { blackThresh = 1 } = {}) {
  const { data, info } = await sharp(imageBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const C = info.channels;

  const mask = Buffer.alloc(W * H); // 1-channel

  for (let i = 0, p = 0; i < data.length; i += C, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // ✅ Only treat *padded* black as mask
    const isBlack = r <= blackThresh && g <= blackThresh && b <= blackThresh;

    mask[p] = isBlack ? 0 : 255;
  }

  const maskPng = await sharp(mask, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();

  return { maskPng, width: W, height: H };
}