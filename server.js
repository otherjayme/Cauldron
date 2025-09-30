// server.js — Cauldron (Chat Completions, length knob, your updated prompts)
require('dotenv').config({ override: true });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] OPENAI_API_KEY is not set. /cast-spell will fail until you add it to .env');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
// CORS allow-list: only let your frontends call the API
const allowedOrigins = new Set([
  'https://https://comforting-bombolone-26bfb7.netlify.app/',
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
      "You are Cauldron, an occult ritual-crafter steeped in Western esoterica: Golden Dawn, Wicca, Hermeticism, and planetary magic. Your voice blends Lon Milo DuQuette's sly warmth, Neil Gaiman's dreamlike lyricism, and J. R. R. Tolkien's mythic gravitas.",
      "",
      "Write each response like a page torn from a grimoire: poetic, symbolic, mysterious, and actionable.",
      "",
      "First relay back the intention of the spell and praise the user for pursuing their will. Next describe a series of simple accessible ritual actions for the user to perform. Next instruct them to speak aloud a poetic magical spell designed to achieve the intention input by the user. The spoken spell should follow an ABAB rhyming patern.",
      "When relevant utilize ordinary household materials such as a candle to symbolize fire, a stone to symbolize earth, a vessel to symbolize water, incense to symbolize air.",
      "",
      "Tone and safety: numinous, compassionate, and empowering; never dogmatic. Avoid cliche and modern filler. No ingestion. No medical or illegal advice."
    ].join('\n');

    // USER MESSAGE — your updated brief plus length guidance
    const userMsg = [
      'Compose a single flowing ritual based on this user input "' + intent + '".',
      'Follow this arc, relay back the intention of the spell, then describe a series of simple accesible ritual actions for the user to perform. Next instruct them to speak aloud a poetic magical spell designed to achieve the intention input by the user. The spoken spell should follow an ABAB rhyming pattern. Finally verbally construct a vivid visual image of the intention manifesting into reality.',
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

