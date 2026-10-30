import { Router } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { supabase } from '../lib/supabase';
import { extractCVData } from '../services/aiManager';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

router.post('/:id/cv', upload.single('cv'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No CV file uploaded.' });
    }

    let text = '';
    if (file.mimetype === 'application/pdf') {
      try {
        const pdfData = await pdfParse(file.buffer);
        text = pdfData.text;
      } catch (err) {
        return res.status(400).json({ error: 'Failed to parse the PDF. Ensure it is a valid PDF document.' });
      }
    } else {
      // Treat as plain text
      text = file.buffer.toString('utf-8');
    }

    if (!text.trim()) {
      return res.status(400).json({ error: 'The uploaded file appears to be empty or contains no readable text.' });
    }

    // Pass to AI for extraction
    const { skills, experience_summary } = await extractCVData(text);
    const cv_parsed_at = new Date().toISOString();

    // Save to Supabase
    const { error: dbError } = await supabase
      .from('users')
      .update({
        skills,
        experience_summary,
        cv_parsed_at,
      })
      .eq('id', id);

    if (dbError) {
      throw dbError;
    }

    res.json({ success: true, skills, experience_summary });
  } catch (error: any) {
    console.error('[AI] /cv parse error:', error);
    res.status(500).json({ error: error.message || 'Failed to process CV.' });
  }
});

export default router;
