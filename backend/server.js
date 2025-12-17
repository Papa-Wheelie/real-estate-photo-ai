import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import imageRoutes from './routes/imageRoutes.js'; // make sure this exists

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Hook up image processing routes
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use('/api/images', imageRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
