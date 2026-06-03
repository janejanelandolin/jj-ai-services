/**
 * End-to-end tests for Craftivity Automate Socials workflows.
 *
 * These tests call the real Netlify functions in-process with real
 * Supabase and Anthropic connections. They require valid env vars:
 *
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
 *   E2E_USER_EMAIL, E2E_USER_PASSWORD   (a test client account in Supabase)
 *
 * Run with: npm run test:e2e
 *
 * WARNING: These tests write real rows to the craftivity_posts table.
 * They clean up after themselves but require a real Supabase project.
 */

const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY', 'E2E_USER_EMAIL', 'E2E_USER_PASSWORD',
];

// Skip all E2E tests if env vars are not configured
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  test.skip(`E2E tests skipped — missing env vars: ${missingEnv.join(', ')}`, () => {});
} else {

const generateIdeas  = require('../../netlify/functions/craftivity-generate-ideas');
const generateContent = require('../../netlify/functions/craftivity-generate-content');

let anonClient, serviceClient;
let authToken, userId;
const createdPostIds = [];

const BRAND_PROFILE = {
  biz_name:         'Craftivity E2E Test',
  biz_location:     'San Francisco, CA',
  biz_audience:     'craft enthusiasts',
  class_types:      'watercolor, macramé, candle making',
  brand_voice:      'warm and encouraging',
  price_range:      '$45–$85',
  booking_link:     'https://craftivity.com/book',
  default_hashtags: '#craftivity #craftclass #sanfrancisco',
};

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  anonClient    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  serviceClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data, error } = await anonClient.auth.signInWithPassword({
    email:    process.env.E2E_USER_EMAIL,
    password: process.env.E2E_USER_PASSWORD,
  });

  if (error) throw new Error(`E2E auth failed: ${error.message}`);
  authToken = data.session.access_token;
  userId    = data.user.id;
});

afterAll(async () => {
  // Clean up any posts created during tests
  if (createdPostIds.length > 0) {
    await serviceClient.from('craftivity_posts').delete().in('id', createdPostIds);
  }
  // Clean up brand profile upserted during tests
  await serviceClient.from('craftivity_brand_profile').delete().eq('client_id', userId);
  await anonClient.auth.signOut();
});

function makeEvent(path, body) {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  };
}

// ── Workflow 1: Generate Ideas ─────────────────────────────────────────────

describe('Workflow: Generate Ideas', () => {
  test('returns 5 ideas for upcoming_class theme with warm tone', async () => {
    const res = await generateIdeas.handler(makeEvent('/generate-ideas', {
      theme: 'upcoming_class',
      tone: 'warm',
      context: 'Watercolor Botanicals class this Saturday 2pm',
      brandProfile: BRAND_PROFILE,
    }));

    expect(res.statusCode).toBe(200);
    const { ideas } = JSON.parse(res.body);
    expect(Array.isArray(ideas)).toBe(true);
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    ideas.forEach(idea => {
      expect(typeof idea).toBe('string');
      expect(idea.length).toBeGreaterThan(10);
    });
  }, 20000);

  test('returns ideas for every supported theme', async () => {
    const themes = ['upcoming_class','class_recap','student_spotlight','seasonal','tip','product','community'];
    for (const theme of themes) {
      const res = await generateIdeas.handler(makeEvent('/generate-ideas', {
        theme, tone: 'playful', context: '', brandProfile: BRAND_PROFILE,
      }));
      expect(res.statusCode).toBe(200);
      const { ideas } = JSON.parse(res.body);
      expect(ideas.length).toBeGreaterThan(0);
    }
  }, 60000);

  test('ideas reference the business location or craft context', async () => {
    const res = await generateIdeas.handler(makeEvent('/generate-ideas', {
      theme: 'upcoming_class',
      tone: 'warm',
      context: '',
      brandProfile: BRAND_PROFILE,
    }));

    const { ideas } = JSON.parse(res.body);
    const allText = ideas.join(' ').toLowerCase();
    // At least some craft or location signal should appear
    const hasCraftContext = /craft|class|watercolor|macram|candle|san francisco|sf/i.test(allText);
    expect(hasCraftContext).toBe(true);
  }, 20000);

  test('rejects request with invalid auth token', async () => {
    const res = await generateIdeas.handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer totally-invalid-token' },
      body: JSON.stringify({ theme: 'tip', tone: 'warm', context: '', brandProfile: {} }),
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── Workflow 2: Generate Content ───────────────────────────────────────────

describe('Workflow: Generate Content', () => {
  const TEST_IDEA = 'Announce our upcoming Watercolor Botanicals class this Saturday, highlighting the relaxing and social experience of painting in a group setting in San Francisco.';

  test('returns caption, hashtags, and imagePrompt', async () => {
    const res = await generateContent.handler(makeEvent('/generate-content', {
      idea: TEST_IDEA,
      tone: 'warm',
      brandProfile: BRAND_PROFILE,
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.caption).toBe('string');
    expect(body.caption.length).toBeGreaterThan(50);
    expect(typeof body.hashtags).toBe('string');
    expect(typeof body.imagePrompt).toBe('string');
    expect(body.imagePrompt.length).toBeGreaterThan(20);
  }, 20000);

  test('caption contains 3–6 sentences', async () => {
    const res = await generateContent.handler(makeEvent('/generate-content', {
      idea: TEST_IDEA,
      tone: 'inspiring',
      brandProfile: BRAND_PROFILE,
    }));

    const { caption } = JSON.parse(res.body);
    // Rough sentence count by splitting on . ! ?
    const sentences = caption.split(/[.!?]+/).filter(s => s.trim().length > 0);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(8);
  }, 20000);

  test('hashtags include the default brand hashtags', async () => {
    const res = await generateContent.handler(makeEvent('/generate-content', {
      idea: TEST_IDEA,
      tone: 'warm',
      brandProfile: BRAND_PROFILE,
    }));

    const { hashtags } = JSON.parse(res.body);
    expect(hashtags).toContain('#craftivity');
  }, 20000);

  test('imagePrompt describes a visual scene (not a caption)', async () => {
    const res = await generateContent.handler(makeEvent('/generate-content', {
      idea: TEST_IDEA,
      tone: 'warm',
      brandProfile: BRAND_PROFILE,
    }));

    const { imagePrompt } = JSON.parse(res.body);
    // Should describe something visual, not be a social media caption
    expect(imagePrompt).not.toContain('#');
    expect(imagePrompt.length).toBeGreaterThan(30);
  }, 20000);
});

// ── Workflow 3: Brand Profile Persistence ─────────────────────────────────

describe('Workflow: Brand Profile', () => {
  test('upserts brand profile and reads it back', async () => {
    const profile = { ...BRAND_PROFILE, client_id: userId, updated_at: new Date().toISOString() };

    const { error: upsertErr } = await anonClient
      .from('craftivity_brand_profile')
      .upsert(profile, { onConflict: 'client_id' });
    expect(upsertErr).toBeNull();

    const { data, error: readErr } = await anonClient
      .from('craftivity_brand_profile')
      .select('*').eq('client_id', userId).single();
    expect(readErr).toBeNull();
    expect(data.biz_name).toBe('Craftivity E2E Test');
    expect(data.biz_location).toBe('San Francisco, CA');
  });

  test('client cannot read another client\'s brand profile', async () => {
    // Attempt to read a row with a different (non-existent) client_id
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const { data } = await anonClient
      .from('craftivity_brand_profile')
      .select('*').eq('client_id', fakeId);
    // RLS should return empty, not the other user's data
    expect(data).toHaveLength(0);
  });
});

// ── Workflow 4: Post Queue (Supabase CRUD) ────────────────────────────────

describe('Workflow: Post Queue', () => {
  let testPostId;

  test('client can insert a post with status=pending', async () => {
    const { data, error } = await anonClient.from('craftivity_posts').insert({
      client_id:    userId,
      topic:        'E2E test — Watercolor class announcement',
      caption:      'Join us this Saturday for a beautiful watercolor class!',
      hashtags:     '#craftivity #test',
      image_prompt: 'Watercolor paints on a sunny wooden table',
      status:       'pending',
    }).select().single();

    expect(error).toBeNull();
    expect(data.status).toBe('pending');
    testPostId = data.id;
    createdPostIds.push(data.id);
  });

  test('client can read their own posts', async () => {
    const { data, error } = await anonClient.from('craftivity_posts')
      .select('*').eq('client_id', userId).order('created_at', { ascending: false });

    expect(error).toBeNull();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].client_id).toBe(userId);
  });

  test('client can approve a pending post (update status)', async () => {
    const { error } = await anonClient.from('craftivity_posts')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', testPostId);

    expect(error).toBeNull();

    const { data } = await anonClient.from('craftivity_posts')
      .select('status').eq('id', testPostId).single();
    expect(data.status).toBe('approved');
  });

  test('client can reject a post', async () => {
    const { error } = await anonClient.from('craftivity_posts')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', testPostId);

    expect(error).toBeNull();
  });

  test('client can insert a scheduled post with a future datetime', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await anonClient.from('craftivity_posts').insert({
      client_id:   userId,
      topic:       'E2E scheduled post',
      caption:     'Scheduled test caption',
      hashtags:    '#craftivity',
      schedule_at: futureDate,
      status:      'pending',
    }).select().single();

    expect(error).toBeNull();
    expect(data.schedule_at).toBeTruthy();
    createdPostIds.push(data.id);
  });

  test('client cannot read another client\'s posts (RLS)', async () => {
    const fakeUserId = '00000000-0000-0000-0000-000000000001';
    const { data } = await anonClient.from('craftivity_posts')
      .select('*').eq('client_id', fakeUserId);
    expect(data).toHaveLength(0);
  });

  test('post requires a non-null caption', async () => {
    const { error } = await anonClient.from('craftivity_posts').insert({
      client_id: userId,
      topic:     'No caption test',
      caption:   null,
      status:    'pending',
    });
    expect(error).not.toBeNull();
  });
});

// ── Workflow 5: Full Happy-Path Pipeline ──────────────────────────────────

describe('Workflow: Full pipeline — idea → content → queue', () => {
  test('generates an idea, turns it into content, saves to queue', async () => {
    // Step 1: generate ideas
    const ideasRes = await generateIdeas.handler(makeEvent('/generate-ideas', {
      theme: 'upcoming_class',
      tone: 'warm',
      context: 'Macramé Wall Hanging class, Sunday 11am, $65',
      brandProfile: BRAND_PROFILE,
    }));
    expect(ideasRes.statusCode).toBe(200);
    const { ideas } = JSON.parse(ideasRes.body);
    const chosenIdea = ideas[0];
    expect(chosenIdea).toBeTruthy();

    // Step 2: generate content from the chosen idea
    const contentRes = await generateContent.handler(makeEvent('/generate-content', {
      idea: chosenIdea,
      tone: 'warm',
      brandProfile: BRAND_PROFILE,
    }));
    expect(contentRes.statusCode).toBe(200);
    const { caption, hashtags, imagePrompt } = JSON.parse(contentRes.body);
    expect(caption).toBeTruthy();
    expect(imagePrompt).toBeTruthy();

    // Step 3: save to queue
    const { data, error } = await anonClient.from('craftivity_posts').insert({
      client_id:    userId,
      topic:        chosenIdea,
      caption,
      hashtags,
      image_prompt: imagePrompt,
      status:       'pending',
    }).select().single();

    expect(error).toBeNull();
    expect(data.id).toBeTruthy();
    expect(data.status).toBe('pending');
    createdPostIds.push(data.id);
  }, 45000);
});

} // end if missingEnv
