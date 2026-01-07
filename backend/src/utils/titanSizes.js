// From Titan Image Generator permissible sizes table.
const SIZES = [
    { w: 1024, h: 1024 },
    { w: 768,  h: 768  },
    { w: 512,  h: 512  },
  
    { w: 768,  h: 1152 },
    { w: 384,  h: 576  },
  
    { w: 1152, h: 768  },
    { w: 576,  h: 384  },
  
    { w: 768,  h: 1280 },
    { w: 384,  h: 640  },
  
    { w: 1280, h: 768  },
    { w: 640,  h: 384  },
  
    { w: 896,  h: 1152 },
    { w: 448,  h: 576  },
  
    { w: 1152, h: 896  },
    { w: 576,  h: 448  },
  
    { w: 768,  h: 1408 },
    { w: 384,  h: 704  },
  
    { w: 1408, h: 768  },
    { w: 704,  h: 384  },
  
    { w: 640,  h: 1408 },
    { w: 320,  h: 704  },
  
    { w: 1408, h: 640  },
    { w: 704,  h: 320  },
  
    { w: 1152, h: 640  },
    { w: 1173, h: 640  }, // 16:9 entry in docs
  ];
  
  // Pick closest aspect ratio, then biggest area.
  export function pickTitanSize(inW, inH) {
    const r = inW / inH;
  
    let best = null;
    for (const s of SIZES) {
      const sr = s.w / s.h;
      const ratioDiff = Math.abs(Math.log(sr / r));
      const area = s.w * s.h;
  
      const score = ratioDiff * 10 - area / 1_000_000;
      if (!best || score < best.score) best = { ...s, score };
    }
  
    return { w: best.w, h: best.h };
  }