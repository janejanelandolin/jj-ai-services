// Generates an Instagram caption from a topic + optional images (vision).
// POST { topic, imageUrls: [], hashtags }
// Returns { caption }

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const BOOKING_PREFIX = 'BOOK NOW: https://craftivity.co/classes\n\n';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // ── Auth ──────────────────────────────────────────────────────────────
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  // ── Parse body ────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { topic = '', imageUrls = [] } = body;
  if (!topic) return { statusCode: 400, body: JSON.stringify({ error: 'topic is required' }) };

  // ── Build Claude message ──────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You write Instagram captions for Craftivity SF — a cozy San Francisco craft class studio. \
Classes include Kokedama, Soap Making, Donut Candles, Floral Arrangements, Macramé, Watercolor, \
Soy Candles, Terrariums, Holiday Wreaths, Air Plants, Resin Art, and Hand-Lettering ($45–$85 per class). \
Your captions are warm, inviting, and community-focused. They use emojis naturally and end with a \
call-to-action. Do NOT include hashtags (added separately). Do NOT include the booking URL (added separately). \
Return ONLY the caption text — no preamble, no quotes.`;

  // Build content blocks
  const content = [];

  // Add up to 5 images via URL (Claude fetches them directly)
  const validUrls = (imageUrls || [])
    .filter(u => typeof u === 'string' && u.startsWith('http'))
    .slice(0, 5);

  for (const url of validUrls) {
    content.push({ type: 'image', source: { type: 'url', url } });
  }

  const imageContext = validUrls.length > 0
    ? `I'm attaching ${validUrls.length} photo(s) from this post. `
    : 'There are no photos attached yet. ';

  content.push({
    type: 'text',
    text: `${imageContext}Post topic: "${topic}"\n\nWrite an engaging, on-brand Instagram caption (2–4 sentences with emojis, ending with a CTA like "Link in bio to book your spot! 🎟️").`,
  });

  // ── Call Claude ────────────────────────────────────────────────────────
  try {
    const message = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 350,
      system:     systemPrompt,
      messages:   [{ role: 'user', content }],
    });

    const caption = BOOKING_PREFIX + message.content[0].text.trim();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption }),
    };
  } catch (err) {
    console.error('Claude error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
