const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const THEME_LABELS = {
  upcoming_class:   'Upcoming Class Announcement',
  class_recap:      'Class Recap / Behind the Scenes',
  student_spotlight:'Student Spotlight',
  seasonal:         'Seasonal / Holiday Craft',
  tip:              'Craft Tip or Technique',
  product:          'Materials & Supply Spotlight',
  community:        'Community & Events',
};

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

  const { theme, tone, context, brandProfile } = JSON.parse(event.body || '{}');

  const biz      = brandProfile?.biz_name     || 'Craftivity';
  const location = brandProfile?.biz_location || 'San Francisco, CA';
  const audience = brandProfile?.biz_audience || 'adults interested in crafts';
  const classes  = brandProfile?.class_types  || 'craft classes';
  const voice    = brandProfile?.brand_voice  || 'warm and community-focused';

  const systemPrompt = `You are a social media content strategist for ${biz}, a storefront in ${location} that hosts craft classes.
Target audience: ${audience}.
Class types: ${classes}.
Brand voice: ${voice}.
Generate ideas that feel authentic, local, and drive engagement or class bookings.`;

  const userPrompt = `Generate 5 distinct Instagram post ideas for the theme: "${THEME_LABELS[theme] || theme}".
Tone: ${TONE_LABELS[tone] || tone}.
${context ? `Additional context: ${context}` : ''}

Return ONLY a JSON array of 5 strings. Each string is a single concise post idea (1–2 sentences describing the angle/hook, not the full caption).
Example format: ["Idea one here", "Idea two here", ...]`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = msg.content[0].text.trim();
    const match = raw.match(/\[[\s\S]*\]/);
    const ideas = match ? JSON.parse(match[0]) : JSON.parse(raw);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideas }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
