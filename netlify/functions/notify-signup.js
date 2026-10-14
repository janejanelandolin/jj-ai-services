// Contact form notification
// Called by a Supabase Database Webhook on INSERT into public.signups,
// then emails the new enquiry via Resend.
//
// Set these environment variables in Netlify:
//   SIGNUP_WEBHOOK_SECRET — shared secret; sent by Supabase as the x-webhook-secret header
//   RESEND_API_KEY        — from resend.com
//   NOTIFY_EMAIL          — where notifications are sent
//   NOTIFY_FROM           — optional sender; defaults to Resend's onboarding address,
//                           which can only deliver to the Resend account owner's email

const crypto = require('crypto');

const PLAN_LABELS = {
  discovery:  'Free Discovery Call',
  strategy:   'Strategy Session — $50',
  standalone: 'Standalone Project — $1,000',
  full:       'Expert Led — $5,000',
  unsure:     'Not sure yet',
};

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function buildEmail(record) {
  const name = `${record.first_name || ''} ${record.last_name || ''}`.trim();
  const rows = [
    ['Name',        name],
    ['Email',       record.email],
    ['Phone',       record.phone || '—'],
    ['Company',     record.company || '—'],
    ['Plan',        PLAN_LABELS[record.plan] || record.plan],
    ['SMS consent', record.sms_consent ? 'Yes' : 'No'],
    ['Message',     record.message || '—'],
    ['Submitted',   record.created_at || new Date().toISOString()],
  ];

  return {
    subject: `New enquiry: ${name} (${PLAN_LABELS[record.plan] || record.plan})`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: `<table cellpadding="6" style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">${
      rows.map(([k, v]) => `<tr><td style="font-weight:600;vertical-align:top;">${k}</td><td style="white-space:pre-wrap;">${escHtml(v)}</td></tr>`).join('')
    }</table>`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secret   = process.env.SIGNUP_WEBHOOK_SECRET;
  const apiKey   = process.env.RESEND_API_KEY;
  const notifyTo = process.env.NOTIFY_EMAIL;
  const from     = process.env.NOTIFY_FROM || 'JJAIServices.com <onboarding@resend.dev>';

  if (!secret || !apiKey || !notifyTo) {
    console.error('Missing environment variables');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  if (!safeEqual(event.headers['x-webhook-secret'] || '', secret)) {
    console.warn('Invalid webhook secret — request rejected');
    return { statusCode: 403, body: 'Forbidden' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const record = payload.record;
  if (payload.type !== 'INSERT' || !record) {
    return { statusCode: 200, body: 'Ignored' };
  }

  const { subject, text, html } = buildEmail(record);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [notifyTo], reply_to: record.email, subject, text, html }),
  });

  if (!res.ok) {
    console.error('Resend error:', res.status, await res.text());
    return { statusCode: 502, body: 'Email send failed' };
  }

  return { statusCode: 200, body: 'Sent' };
};

exports.buildEmail = buildEmail;
