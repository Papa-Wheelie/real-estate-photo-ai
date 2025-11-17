#!/usr/bin/env python3
"""
Step 3: Auto-straighten verticals (rotation only) + exposure tweak.
- Load + EXIF rotate (Pillow)
- Detect near-vertical lines (OpenCV)
- Estimate small global rotation and correct it
- Apply a gentle exposure/contrast tweak
- Save JPEG
"""
import argparse
from pathlib import Path
from typing import List, Tuple

import numpy as np
from PIL import Image, ImageOps
import cv2


# ---------------- I/O ----------------

def load_image_with_exif_rotate(path: Path) -> Image.Image:
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")

def save_image(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="JPEG", quality=92, optimize=True)

def pil_to_np(img: Image.Image) -> np.ndarray:
    return np.array(img, dtype=np.uint8)

def np_to_pil(arr: np.ndarray) -> Image.Image:
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


# ---------------- Exposure / Contrast ----------------

def apply_exposure_contrast(
    rgb: np.ndarray,
    exposure_ev: float = 0.15,
    contrast: float = 1.05,
) -> np.ndarray:
    gain = 2.0 ** exposure_ev
    f = rgb.astype(np.float32) * gain
    f = (f - 128.0) * contrast + 128.0
    return np.clip(f, 0, 255).astype(np.uint8)


# ---------------- Geometry: make verticals vertical ----------------

def _hough_vertical_angles(bgr: np.ndarray) -> List[float]:
    """
    Return angles (in degrees) of near-vertical line segments.
    Angle is measured relative to the x-axis; vertical lines ~ +/-90 degrees.
    We normalize angles to a small deviation around 90deg (e.g., 90±5 -> +/-5).
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # Edge detection
    edges = cv2.Canny(gray, 50, 150, apertureSize=3, L2gradient=True)

    # Probabilistic Hough to get segments
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=max(20, int(min(bgr.shape[:2]) * 0.1)),
        maxLineGap=10,
    )

    if lines is None:
        return []

    angles = []
    for x1, y1, x2, y2 in lines[:, 0, :]:
        dx = x2 - x1
        dy = y2 - y1
        if dx == 0 and dy == 0:
            continue
        angle_rad = np.arctan2(dy, dx)  # radians, relative to x-axis
        angle_deg = np.degrees(angle_rad)

        # Convert to deviation from 90 degrees:
        # e.g., 87deg -> -3deg (tilted left), 93deg -> +3deg (tilted right)
        # First, fold angle into [-90, 90]
        while angle_deg <= -90:
            angle_deg += 180
        while angle_deg > 90:
            angle_deg -= 180

        # Keep only near-vertical segments (|angle| close to 90)
        if abs(abs(angle_deg) - 90) <= 15:  # allow 15° window
            dev_from_vertical = angle_deg - (90 if angle_deg >= 0 else -90)
            angles.append(dev_from_vertical)
    return angles


def estimate_rotation_deg_from_verticals(
    rgb: np.ndarray,
    max_expected_deg: float = 5.0
) -> float:
    """
    Estimate small global rotation to make verticals truly vertical.
    Returns degrees to rotate counter-clockwise (positive = CCW).
    We cap to +/-max_expected_deg to avoid wild swings.
    """
    # OpenCV wants BGR
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    angles = _hough_vertical_angles(bgr)
    if not angles:
        return 0.0

    # Robust central tendency: weighted median would be ideal;
    # here we use simple median which works well for most interiors.
    rot = np.median(angles)

    # Clamp to a safe range (user can override via CLI)
    rot = float(np.clip(rot, -max_expected_deg, +max_expected_deg))
    return rot


def rotate_image(rgb: np.ndarray, deg_ccw: float) -> np.ndarray:
    """
    Rotate keeping size (no crop). Uses border replication to avoid black corners.
    """
    h, w = rgb.shape[:2]
    center = (w / 2.0, h / 2.0)
    M = cv2.getRotationMatrix2D(center, deg_ccw, 1.0)
    rotated = cv2.warpAffine(
        rgb, M, (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE
    )
    return rotated


# ---------------- Main ----------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ev", type=float, default=0.15, help="Exposure in EV (e.g. 0.15)")
    parser.add_argument("--contrast", type=float, default=1.05, help="Contrast multiplier (e.g. 1.05)")
    parser.add_argument("--auto_rotate_verticals", action="store_true",
                        help="Enable auto-straighten using vertical lines")
    parser.add_argument("--max_rotate_deg", type=float, default=5.0,
                        help="Max absolute rotation to apply (safety clamp)")
    args = parser.parse_args()

    # Load
    pil_img = load_image_with_exif_rotate(args.input)
    arr = pil_to_np(pil_img)

    # Geometry: auto-straighten (optional)
    if args.auto_rotate_verticals:
        rot = estimate_rotation_deg_from_verticals(arr, max_expected_deg=args.max_rotate_deg)
        if abs(rot) > 0.01:
            arr = rotate_image(arr, -rot)  # negate: if lines lean +3°, rotate -3° to correct

    # Exposure
    arr = apply_exposure_contrast(arr, exposure_ev=args.ev, contrast=args.contrast)

    # Save
    out = np_to_pil(arr)
    save_image(out, args.output)
    print(f"✅ Wrote: {args.output}")

if __name__ == "__main__":
    main()
