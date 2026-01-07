import { Router } from "express";
import multer from "multer";
import { processImage, processPro, processBrightFresh } from "../controllers/imageController.js";

const router = Router();

// IMPORTANT: this path is relative to where you run node (backend/),
// so "uploads/" maps to backend/uploads/
const upload = multer({ dest: "uploads/" });

// Stage 1: single image → Bright & Fresh JPEG
router.post("/bright-fresh", upload.single("image"), processBrightFresh);

// Existing routes (keep as-is)
router.post("/process", upload.single("image"), processImage);
router.post("/pro", upload.single("image"), processPro);

export default router;
