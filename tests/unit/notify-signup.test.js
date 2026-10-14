/**
 * Unit tests for netlify/functions/notify-signup.js
 * Resend is mocked via global.fetch.
 */

const { handler, buildEmail } = require('../../netlify/functions/notify-signup');

const SECRET = 'test-secret';
const record = {
  first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com',
  phone: null, company: 'Analytical Engines', plan: 'strategy',
  message: '<b>hi</b>', sms_consent: false, created_at: '2026-10-14T12:00:00Z',
};

function makeEvent({ secret = SECRET, body = { type: 'INSERT', table: 'signups', record }, method = 'POST' } = {}) {
  return { httpMethod: method, headers: { 'x-webhook-secret': secret }, body: JSON.stringify(body) };
}

beforeEach(() => {
  process.env.SIGNUP_WEBHOOK_SECRET = SECRET;
  process.env.RESEND_API_KEY = 're_test';
  process.env.NOTIFY_EMAIL = 'owner@example.com';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('sends an email for a new signup', async () => {
  const res = await handler(makeEvent());
  expect(res.statusCode).toBe(200);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails');
  const sent = JSON.parse(opts.body);
  expect(sent.to).toEqual(['owner@example.com']);
  expect(sent.reply_to).toBe('ada@example.com');
  expect(sent.subject).toBe('New enquiry: Ada Lovelace (Strategy Session — $50)');
});

test('rejects a wrong secret', async () => {
  const res = await handler(makeEvent({ secret: 'nope' }));
  expect(res.statusCode).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('rejects non-POST', async () => {
  expect((await handler(makeEvent({ method: 'GET' }))).statusCode).toBe(405);
});

test('ignores non-INSERT events', async () => {
  const res = await handler(makeEvent({ body: { type: 'UPDATE', record } }));
  expect(res.statusCode).toBe(200);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('reports a Resend failure', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
  expect((await handler(makeEvent())).statusCode).toBe(502);
});

test('fails clearly when env vars are missing', async () => {
  delete process.env.RESEND_API_KEY;
  expect((await handler(makeEvent())).statusCode).toBe(500);
});

test('escapes HTML in the email body', () => {
  const { html, text } = buildEmail(record);
  expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
  expect(html).not.toContain('<b>hi</b>');
  expect(text).toContain('Phone: —');
});
