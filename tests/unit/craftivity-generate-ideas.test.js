/**
 * Unit tests for craftivity-generate-ideas Netlify function.
 * Anthropic and Supabase are mocked — no real API calls made.
 */

jest.mock('@anthropic-ai/sdk');
jest.mock('@supabase/supabase-js');

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { handler } = require('../../netlify/functions/craftivity-generate-ideas');

const MOCK_USER = { id: 'user-123', email: 'test@example.com' };

function mockSupabaseAuth(user = MOCK_USER, error = null) {
  createClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user }, error }) },
  });
}

function mockAnthropicResponse(text) {
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text }],
      }),
    },
  }));
}

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer fake-token' },
    body: JSON.stringify({
      theme: 'upcoming_class',
      tone: 'warm',
      context: '',
      brandProfile: {
        biz_name: 'Craftivity',
        biz_location: 'San Francisco, CA',
        biz_audience: 'craft enthusiasts',
        class_types: 'watercolor, macramé',
        brand_voice: 'warm and encouraging',
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

test('returns 401 when Supabase auth fails', async () => {
  mockSupabaseAuth(null, new Error('invalid token'));
  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(401);
});

test('returns 401 when Supabase returns no user', async () => {
  mockSupabaseAuth(null, null);
  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(401);
});

// ── Happy path ─────────────────────────────────────────────────────────────

test('returns 200 with array of 5 ideas on valid request', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse('["Idea 1", "Idea 2", "Idea 3", "Idea 4", "Idea 5"]');

  const res = await handler(makeEvent());

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(Array.isArray(body.ideas)).toBe(true);
  expect(body.ideas).toHaveLength(5);
  expect(body.ideas[0]).toBe('Idea 1');
});

test('parses ideas when JSON is wrapped in extra text', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse('Here are your ideas:\n["Idea A", "Idea B", "Idea C", "Idea D", "Idea E"]\nHope that helps!');

  const res = await handler(makeEvent());

  expect(res.statusCode).toBe(200);
  const { ideas } = JSON.parse(res.body);
  expect(ideas).toHaveLength(5);
  expect(ideas[0]).toBe('Idea A');
});

test('uses default brand profile values when brandProfile is empty', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse('["Idea 1","Idea 2","Idea 3","Idea 4","Idea 5"]');

  const event = makeEvent({
    body: JSON.stringify({ theme: 'tip', tone: 'playful', context: '', brandProfile: {} }),
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  // Verify Anthropic was called (defaults filled in without crashing)
  expect(Anthropic).toHaveBeenCalled();
});

test('includes additional context in prompt when provided', async () => {
  mockSupabaseAuth();
  let capturedMessages;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedMessages = params.messages;
        return { content: [{ text: '["I1","I2","I3","I4","I5"]' }] };
      }),
    },
  }));

  const event = makeEvent({
    body: JSON.stringify({
      theme: 'upcoming_class',
      tone: 'warm',
      context: 'Watercolor Botanicals — Saturday 2pm, 3 spots left',
      brandProfile: {},
    }),
  });
  await handler(event);

  expect(capturedMessages[0].content).toContain('Watercolor Botanicals');
});

test('uses unknown theme value as-is in prompt', async () => {
  mockSupabaseAuth();
  let capturedMessages;
  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async (params) => {
        capturedMessages = params.messages;
        return { content: [{ text: '["I1","I2","I3","I4","I5"]' }] };
      }),
    },
  }));

  const event = makeEvent({
    body: JSON.stringify({ theme: 'custom_theme', tone: 'warm', context: '', brandProfile: {} }),
  });
  await handler(event);

  expect(capturedMessages[0].content).toContain('custom_theme');
});

// ── Error handling ─────────────────────────────────────────────────────────

test('returns 500 when Anthropic throws', async () => {
  mockSupabaseAuth();
  Anthropic.mockImplementation(() => ({
    messages: { create: jest.fn().mockRejectedValue(new Error('API overloaded')) },
  }));

  const res = await handler(makeEvent());

  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body).error).toBe('API overloaded');
});

test('returns 500 when Claude returns unparseable JSON', async () => {
  mockSupabaseAuth();
  mockAnthropicResponse('Sorry, I cannot help with that.');

  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(500);
});
