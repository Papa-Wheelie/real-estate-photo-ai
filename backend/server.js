import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import imageRoutes from './routes/imageRoutes.js'; // make sure this exists
import { tonePresets } from './tonePresets.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Hook up image processing routes
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get('/api/tones', (_req, res) => {
  res.json({
    tones: [
      { id: 'bright-fresh', label: 'Bright & Fresh' },
      { id: 'warm-sunset', label: 'Warm Sunset' },
      { id: 'moody', label: 'Moody Dusk' },
      { id: 'light-filled', label: 'Light Filled' },
      { id: 'natural', label: 'Natural' },
    ],
  });
});

app.use('/api/images', imageRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
