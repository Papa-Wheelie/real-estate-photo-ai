import { Router } from "express";
import multer from "multer";
import {
  processImage,
  processPro,
  processBrightFresh,
  processBrightFreshBatch,
} from "../controllers/imageController.js";

const router = Router();

// "uploads/" maps to backend/uploads/
const upload = multer({ dest: "uploads/" });

// Stage 1: single image → Bright & Fresh JPEG
router.post("/bright-fresh", upload.single("image"), processBrightFresh);

// Stage 1: batch images → ZIP of Bright & Fresh JPEGs
router.post("/bright-fresh/batch", upload.array("images", 30), processBrightFreshBatch);

// Legacy
router.post("/process", upload.single("image"), processImage);
router.post("/pro", upload.single("image"), processPro);

export default router;
