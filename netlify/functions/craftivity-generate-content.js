const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const TONE_LABELS = {
  warm:        'warm and welcoming',
  playful:     'playful and fun',
  inspiring:   'inspiring and uplifting',
  informative: 'informative and educational',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const { data: { user }, error: authErr } = await createClient(
    process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY
  ).auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const { idea, tone, brandProfile } = JSON.parse(event.body || '{}');

  const biz         = brandProfile?.biz_name        || 'Craftivity';
  const location    = brandProfile?.biz_location    || 'San Francisco, CA';
  const audience    = brandProfile?.biz_audience    || 'adults interested in crafts';
  const classes     = brandProfile?.class_types     || 'craft classes';
  const voice       = brandProfile?.brand_voice     || 'warm and community-focused';
  const priceRange  = brandProfile?.price_range     || '';
  const bookingLink = brandProfile?.booking_link    || '';
  const defaultTags = brandProfile?.default_hashtags|| '#craftivity #craftclass #sanfrancisco';

  const systemPrompt = `You are a social media copywriter for ${biz}, a storefront in ${location} that hosts craft classes.
Target audience: ${audience}.
Class types offered: ${classes}.
Brand voice: ${voice}.
${priceRange ? `Price range: ${priceRange}.` : ''}
${bookingLink ? `Booking link: ${bookingLink}.` : ''}
Write Instagram captions that feel authentic, conversational, and drive engagement or bookings.
Captions should be 3–6 sentences. Do not use generic filler phrases.`;

  const userPrompt = `Write an Instagram caption for this post idea: "${idea}"
Tone: ${TONE_LABELS[tone] || tone}.

Also write a DALL-E image generation prompt for a high-quality, warm, lifestyle photo that would pair with this post. The image should feel authentic and artisan — not stock photo generic.

Return ONLY valid JSON with this exact shape:
{
  "caption": "...",
  "hashtags": "${defaultTags}",
  "imagePrompt": "..."
}`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = msg.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : JSON.parse(raw);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
