// server.js — Cauldron (Chat Completions, length knob, your updated prompts)
require('dotenv').config({ override: true });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

// ------- Spell route (poetic, flowing; single length knob) -------
app.post('/cast-spell', async (req, res) => {
  try {
    const body = req.body || {};
    const intent = (body.intent || '').trim();
    const length = (body.length || 'long').toLowerCase();

    if (!intent) {
      return res.status(400).json({ error: 'No intention provided.' });
    }

    // Length presets
    const lengthConfig = {
      long:   { max_tokens: 260, guide: 'Length about 150 to 220 words.' },
      medium: { max_tokens: 140, guide: 'Length about 75 to 110 words.' },
      short:  { max_tokens:  80, guide: 'Length about 35 to 55 words.' }
    };
    const L = lengthConfig[length] || lengthConfig.long;

    // SYSTEM MESSAGE — your updated text (ASCII-only, via join to avoid quote issues)
    const systemMsg = [
      "You are CAULDRON, a web app designed for witches, shamans, and those who wish to manifest their will in the real world through the art of spellcraft and focused intention. Draw from the teachings of the Golden Dawn, the writings of Lon Milo DuQuette, and general knowledge about astrological and lunar cycles for tone and imagery.",
      "",
      "Write each response like a page torn from a grimoire: poetic, symbolic, mysterious, and actionable. Each response should contain a simple ritual action as well as a rhyming spell to be spoken aloud.",
      "",
      "When relevant, spells may reference generic deities such as The Gods, The Goddess, The Creator, and The Spirit.",
      "",
      "When specifically mentioned, utilize materials and items such as a candle to symbolize fire, a stone to symbolize earth, a vessel to symbolize water, incense to symbolize air.",
      "",
      "Tone and safety: numinous, compassionate, and empowering. Do not suggest ingestion or self-harm. Do not suggest violence. No medical or illegal advice."
    ].join('\n');

    // USER MESSAGE — your updated brief plus length guidance
    const userMsg = [
      'Your goal is to create a short, simple spell that seeks to achieve the following: "' + intent + '".',
      'Your reply should start with the words "The Cauldron boils furiously, a thick smog fills the room as your answer materializes on the surface of the liquid," followed by a short, simple spell the user can perform to achieve their desired goal. Make safety a priority and do not suggest anything dangerous or harmful to the user or others. Utilize fun, poetic, witchy language laden with symbolism and metaphor, and when possible deliver your answer in poetic rhyme. The tone should walk the line between The Lord of the Rings and Aleister Crowley.',
      L.guide
    ].join('\n');

    // OpenAI call
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.85,
      max_tokens: L.max_tokens,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ],
      presence_penalty: 0.3,
      frequency_penalty: 0.2
    });

    const spell =
      (completion && completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content || '').trim() ||
      'The spirits whisper, but words fail to form.';

    res.json({ spell });
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
