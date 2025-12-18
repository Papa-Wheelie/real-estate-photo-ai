import { Router } from "express";
import multer from "multer";
import { processImage, processPro } from "../controllers/imageController.js";

const router = Router();

// IMPORTANT: this path is relative to where you run node (backend/),
// so "uploads/" maps to backend/uploads/
const upload = multer({ dest: "uploads/" });

router.post("/process", upload.single("image"), processImage);
// router.post("/ai-variation", upload.single("image"), aiVariation);
router.post("/pro", upload.single("image"), processPro);


export default router;
