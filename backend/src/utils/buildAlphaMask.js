import sharp from "sharp";

// Returns a PNG mask: 0 = inpaint, 255 = keep
export async function buildAlphaPaddingMaskPng(rgbaPngBuf) {
  const { data, info } = await sharp(rgbaPngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const C = info.channels; // 4

  const mask1 = Buffer.alloc(W * H);

  for (let i = 0, p = 0; i < data.length; i += C, p++) {
    const a = data[i + 3];
    mask1[p] = (a === 0) ? 0 : 255; // transparent padding => inpaint
  }

  return sharp(mask1, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}
