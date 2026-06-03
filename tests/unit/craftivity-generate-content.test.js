/**
 * Unit tests for craftivity-generate-content Netlify function.
 * Anthropic and Supabase are mocked — no real API calls made.
 */

jest.mock('@anthropic-ai/sdk');
jest.mock('@supabase/supabase-js');

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { handler } = require('../../netlify/functions/craftivity-generate-content');

const MOCK_USER = { id: 'user-123', email: 'test@example.com' };

const VALID_RESPONSE = JSON.stringify({
  caption: 'Come join us for a magical watercolor class this Saturday!',
  hashtags: '#craftivity #craftclass #sanfrancisco',
  imagePrompt: 'Warm lifestyle photo of watercolor paints and brushes on a wooden table in a sunny SF studio',
});

function mockSupabaseAuth(user = MOCK_USER, error = null) {
  createClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user }, error }) },
  });
}

function mockAnthropicResponse(text) {
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({ content: [{ text }] }),
    },
  }));
}

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer fake-token' },
    body: JSON.stringify({
      idea: 'Announce our Watercolor Botanicals class this Saturday with a focus on the relaxing, social experience',
      tone: 'warm',
      brandProfile: {
        biz_name: 'Craftivity',
        biz_location: 'San Francisco, CA',
        biz_audience: 'adults 25–55, craft enthusiasts',
        class_types: 'watercolor, macramé, resin art',
        brand_voice: 'warm and encouraging',
        price_range: '$45–$85',
        booking_link: 'https://craftivity.com/book',
        default_hashtags: '#craftivity #craftclass #sanfrancisco',
      },
    }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
  process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

// ── HTTP method guard ──────────────────────────────────────────────────────

test('returns 405 for GET requests', async () => {
  const res = await handler(makeEvent({ httpMethod: 'GET' }));
  expect(res.statusCode).toBe(405);
});

// ── Auth guard ─────────────────────────────────────────────────────────────

test('returns 401 when no Authorization header', async () => {
  const res = await handler(makeEvent({ headers: {} }));
  expect(res.statusCode).toBe(401);
});

test('returns 401 when Supabase returns no user', async () => {
  mockSupabaseAuth(null, null);
  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(401);
});

// ── Happy path ─────────────────────────────────────────────────────────────

test('returns 200 with caption, hashtags, and imagePrompt', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse(VALID_RESPONSE);

  const res = await handler(makeEvent());

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body).toHaveProperty('caption');
  expect(body).toHaveProperty('hashtags');
  expect(body).toHaveProperty('imagePrompt');
});

test('caption is a non-empty string', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse(VALID_RESPONSE);

  const res = await handler(makeEvent());
  const { caption } = JSON.parse(res.body);

  expect(typeof caption).toBe('string');
  expect(caption.length).toBeGreaterThan(0);
});

test('parses content when JSON is wrapped in extra prose', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse(`Sure! Here's the content:\n${VALID_RESPONSE}\nLet me know if you'd like changes.`);

  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.caption).toBeTruthy();
});

test('uses default hashtags when brandProfile has none', async () => {
  mockSupabaseAuth();
  let capturedMessages;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedMessages = params.messages;
        return { content: [{ text: VALID_RESPONSE }] };
      }),
    },
  }));

  const event = makeEvent({
    body: JSON.stringify({ idea: 'Test idea', tone: 'warm', brandProfile: {} }),
  });
  await handler(event);

  expect(capturedMessages[0].content).toContain('#craftivity #craftclass #sanfrancisco');
});

test('includes booking link in system prompt when provided', async () => {
  mockSupabaseAuth();
  let capturedSystem;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedSystem = params.system;
        return { content: [{ text: VALID_RESPONSE }] };
      }),
    },
  }));

  await handler(makeEvent());

  expect(capturedSystem).toContain('https://craftivity.com/book');
});

test('includes price range in system prompt when provided', async () => {
  mockSupabaseAuth();
  let capturedSystem;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedSystem = params.system;
        return { content: [{ text: VALID_RESPONSE }] };
      }),
    },
  }));

  await handler(makeEvent());

  expect(capturedSystem).toContain('$45–$85');
});

test('omits booking link line from system prompt when not provided', async () => {
  mockSupabaseAuth();
  let capturedSystem;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedSystem = params.system;
        return { content: [{ text: VALID_RESPONSE }] };
      }),
    },
  }));

  const event = makeEvent({
    body: JSON.stringify({ idea: 'Test', tone: 'warm', brandProfile: { booking_link: '' } }),
  });
  await handler(event);

  expect(capturedSystem).not.toContain('Booking link:');
});

// ── All tones ──────────────────────────────────────────────────────────────

test.each([
  ['warm',        'warm and welcoming'],
  ['playful',     'playful and fun'],
  ['inspiring',   'inspiring and uplifting'],
  ['informative', 'informative and educational'],
])('tone "%s" maps to "%s" in user prompt', async (toneKey, toneLabel) => {
  mockSupabaseAuth();
  let capturedMessages;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedMessages = params.messages;
        return { content: [{ text: VALID_RESPONSE }] };
      }),
    },
  }));

  const event = makeEvent({
    body: JSON.stringify({ idea: 'Test idea', tone: toneKey, brandProfile: {} }),
  });
  await handler(event);

  expect(capturedMessages[0].content).toContain(toneLabel);
});

// ── Error handling ─────────────────────────────────────────────────────────

test('returns 500 when Anthropic throws', async () => {
  mockSupabaseAuth();
  Anthropic.mockImplementation(() => ({
    messages: { create: jest.fn().mockRejectedValue(new Error('Rate limit exceeded')) },
  }));

  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body).error).toBe('Rate limit exceeded');
});

test('returns 500 when Claude returns malformed JSON', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse('I cannot generate that content.');

  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(500);
});
