export const tonePresets = {
  // Bright + fresh: lift exposure, cool slightly, keep it crisp
  'bright-fresh': {
    brightness: 1.16,
    saturation: 1.02, // was 1.04 (calm the greens)
    contrast: 1.04,
    gamma: 1.0,
    rgb: [0.985, 1.0, 1.045], // tiny step back from cool
    overlay: { color: { r: 245, g: 250, b: 255, alpha: 0.20 }, blend: 'screen' } // was 0.22
  },

  // Moody dusk-ish: darker midtones, warmer shadows, vignette
  'moody': {
    brightness: 0.97,                 // lift overall slightly
    saturation: 0.98,
    contrast: 1.12,                   // reduce shadow crush a bit
    gamma: 1.02,                      // less midtone darkening
    rgb: [1.02, 1.0, 0.98],
    overlay: { color: { r: 25, g: 35, b: 60, alpha: 0.16 }, blend: 'multiply' }, // reduce tint strength
    vignette: 0.18                    // lighter vignette
  },

  'light-filled': {
    brightness: 1.06,
    saturation: 1.03,
    contrast: 1.06,
    gamma: 1.0,
    rgb: [1.0, 1.0, 1.0]
  },

  'warm-sunset': {
    brightness: 1.07,
    saturation: 1.04,
    contrast: 1.06,
    gamma: 1.0,
    rgb: [1.05, 1.02, 0.96], // warmer than before
    overlay: { color: { r: 255, g: 205, b: 140, alpha: 0.22 }, blend: 'soft-light' },
    vignette: 0.08
  },

  'natural': {
    brightness: 1.0,
    saturation: 1.0,
    contrast: 1.0,
    gamma: 1.0,
    rgb: [1.0, 1.0, 1.0]
  }
};
