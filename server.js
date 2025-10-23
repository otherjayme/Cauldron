// server.js — Cauldron (Chat Completions, length knob, your updated prompts)
require('dotenv').config({ override: true });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// --- Database setup ---
const { Pool } = require('pg');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


const app = express();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PROMPT_VERSION = 'v1.3-lyric-variants';


if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] OPENAI_API_KEY is not set. /cast-spell will fail until you add it to .env');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
// CORS allow-list: only let your frontends call the API
const allowedOrigins = new Set([
  'https://comforting-bombolone-26bfb7.netlify.app', // <- fixed (no double https, no trailing slash)
  'https://cauldron.online',
]);

app.use(cors({
  origin(origin, callback) {
    // allow non-browser tools (no Origin header) like curl/Postman/Render health checks
    if (!origin) return callback(null, true);
    return callback(null, allowedOrigins.has(origin));
  },
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use((req, _res, next) => {
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.url);
  next();
});
app.use(express.static('public'));

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, hasApiKey: !!process.env.OPENAI_API_KEY, model: MODEL });
});

// ------- Spell route (supports short | medium | long) -------
app.post('/cast-spell', async (req, res) => {
  try {
    const body = req.body || {};
    const intent = (body.intent || '').trim();
    const length = (body.length || 'medium').toLowerCase();

    if (!intent) {
      return res.status(400).json({ error: 'No intention provided.' });
    }

    // Length presets (word guidance + token caps)
    const lengthConfig = {
      short:  {
        max_tokens: 190, // ~70–100 words
        guide: [
          'Length: ~120–180 words total.',
          'Use 3–4 concise ritual steps; poem 6–8 lines.'
        ].join(' ')
      },
      medium: {
        max_tokens: 380, // ~120–160 words
        guide: [
          'Length: ~180–250 words total.',
          'Use 4–6 concise ritual steps; poem 8–10 lines.'
        ].join(' ')
      },
      long:   {
        max_tokens: 500, // ~180–230 words
        guide: [
          'Length: ~250–500 words total.',
          'Use 5–7 concise ritual steps; poem 10–12 lines.'
        ].join(' ')
      }
    };
    const L = lengthConfig[length] || lengthConfig.medium;

    // SYSTEM MESSAGE
    const systemMsg = [
      'You are CAULDRON — a poetic ritual-crafter with sly warmth, dreamlike lyricism, and mythic gravitas.',
      'Write like a page torn from a grimoire: vivid, symbolic, mysterious, and actionable.',

      'STYLE & SAFETY',
      '- Tone: numinous, compassionate, empowering. Never dogmatic.',
      '- Safety: no ingestion, no self-harm, no medical/legal advice, no fire left unattended. ',
      "- Respect all traditions; keep references generic unless the user is specific (e.g., 'The Goddess', 'The Spirit').",

      'CONTENT PALETTE (household-first):',
      'candle, a coin, a bandana, bowl of water, pinch of salt, small stone, string/twine, paper, pen, mirror, key, cup, bread/cracker, bell, simple incense (optional), breath, hands, window light.',
      'If an item might be unavailable, offer a substitute in parentheses.',

      'TROPES (draw 2–3 as fitting):',
      '- Breath pattern (e.g., 4-4-4-4).',
      '- Gesture/kinetic: tie a knot, trace a circle, tap three times.',
      '- Invocation: address a generic divine/elemental presence.',
      '- Sigil/lightwork: mark a simple symbol; imagine it glowing.',
      '- Offering/grounding: a crumb of bread or a still moment by a window.',
      '- Seal/close: extinguish, fold, or place the item somewhere specific.',

      'POETIC VARIATION FOR SPOKEN PORTION (choose ONE each response; do not announce):',
      '- ABAB cross-rhyme (8–12 lines) OR',
      '- AABB couplets (8–12 lines) OR',
      '- Non rhyming but with rythm and poetic weight',
      '- Chant with refrain (repeat line 1 at lines 5 and last) OR',
      '- Free-verse incantation (8–10 lines; no end-rhyme, strong internal echoes).',

      'QUALITY GUARDRAILS',
      '- Maintain an enigmatic and profound tone',
      '- AVOID CORNY AND CRINGEY LANGUAGE',
      '- utilize a diverse and descriptive vocabulary that might be found in a very old grimoire',
      '- Do not attempt to rhyme words that do not share the same sound.  prefer non rhyming phrasing to clumsily constructed rhymes',
      "- Avoid clichés like 'manifest your dreams' or 'positive vibes'.",
      '- Prefer fresh, sensory imagery.'
    ].join('\n');

    // USER MESSAGE
    const userMsg = [
      `User intention: "${intent}"`,
      '',
      'Deliver exactly this arc in one flowing piece of text:',
      '1) Echo the intention respectfully in one evocative line.',
      '2) 3–7 concise ritual steps (≤12 words each), using household items or breath/gesture (count depends on length).',
      '3) The spoken spell using ONE chosen poetic pattern (see system).',
      '4) A brief visualization that shows the intention realized.',
      '',
      'Constraints:',
      L.guide,
      '- Offer safe alternatives for flames (e.g., LED/phone light).',
      '- Avoid rare herbs, specific crystals, therapy/medical language, or moralizing.'
    ].join('\n');

    // OpenAI call
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.88,
      max_tokens: L.max_tokens,
      presence_penalty: 0.5,
      frequency_penalty: 0.2,
      messages: [
        { role: 'system', content: systemMsg + `\n\nPROMPT_VERSION=${PROMPT_VERSION}` },
        { role: 'user', content: userMsg }
      ]
    });

    const spell =
      (completion &&
       completion.choices &&
       completion.choices[0] &&
       completion.choices[0].message &&
       completion.choices[0].message.content || '').trim()
      || 'The spirits whisper, but words fail to form.';

    res.json({ spell });

    // --- Save to database (async, non-blocking) ---
db.query(
  `INSERT INTO spells (intent, length, spell_text, ua, ip_hash)
   VALUES ($1, $2, $3, $4, $5)`,
  [
    intent,
    length,
    spell,
    req.get('user-agent') || '',
    require('crypto').createHash('sha256').update(req.ip || '').digest('hex').slice(0,16)
  ]
).catch(err => console.error('DB insert failed:', err.message));

  } catch (e) {
    const log = {
      at: '/cast-spell (chat)',
      status: e?.status || e?.response?.status,
      message: e?.message,
      data: e?.response?.data || null
    };
    console.error('Chat error ->', log);
    res.status(500).json({ error: log.data?.error?.message || log.message || 'OpenAI error' });
  }
});


// Subscribe route (ASCII-safe)
app.post('/subscribe', (req, res) => {
  const email = (req.body && req.body.email) || '';
  if (!email || email.indexOf('@') === -1) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const filePath = path.join(__dirname, 'emails.json');

  try {
    const fileData = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
      : [];

    if (fileData.indexOf(email) !== -1) {
      return res.status(200).json({ message: 'Email already subscribed.' });
    }

    fileData.push(email);
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));

    console.log('New subscriber:', email);
    res.status(200).json({ message: 'Subscription successful!' });

  } catch (err) {
    console.error('Email subscription error:', err);
    res.status(500).json({ error: 'Failed to save email.' });
  }
});

// Start server (uses env PORT if provided; falls back to 3000)
const PORT = process.env.PORT || 3000;

// If a host ever requires binding to all interfaces, add the second arg:
// const server = app.listen(PORT, '0.0.0.0', () => {
const server = app.listen(PORT, () => {
  const addr = server.address();
  const actualPort = typeof addr === 'string' ? addr : addr?.port;
  console.log(`Cauldron server brewing on port ${actualPort}`);
});
