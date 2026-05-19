// Twilio inbound SMS webhook
// Handles START (opt-in), STOP (opt-out), HELP keywords
// and saves/updates records in Supabase.
//
// Set these environment variables in Netlify:
//   SUPABASE_URL        — your Supabase project URL
//   SUPABASE_SERVICE_KEY — your Supabase service_role key (NOT the anon key)
//   TWILIO_AUTH_TOKEN   — from Twilio console, used to validate requests

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const qs = require('querystring');

const OPT_IN_KEYWORDS  = ['START', 'JOIN', 'YES', 'UNSTOP'];
const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'];
const HELP_KEYWORDS    = ['HELP', 'INFO'];

const MESSAGES = {
  optIn:  'You are now subscribed to JJAIServices.com updates. Msg & data rates may apply. Reply STOP to unsubscribe, HELP for help.',
  optOut: 'You have been unsubscribed from JJAIServices.com. No further messages will be sent. Reply START to resubscribe.',
  help:   'JJAIServices.com: AI consulting & services. Visit jjaiservices.com for support. Msg & data rates may apply. Reply STOP to unsubscribe.',
};

// Validate the request genuinely came from Twilio
function validateTwilioSignature(authToken, twilioSignature, url, params) {
  const sortedKeys = Object.keys(params).sort();
  let str = url;
  sortedKeys.forEach(k => { str += k + params[k]; });
  const hmac = crypto.createHmac('sha1', authToken).update(str).digest('base64');
  return hmac === twilioSignature;
}

// Parse application/x-www-form-urlencoded body from Twilio
function parseBody(body) {
  return qs.parse(body);
}

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!authToken || !supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  // Validate Twilio signature
  const twilioSignature = event.headers['x-twilio-signature'] || '';
  const fullUrl = `https://${event.headers.host}/.netlify/functions/sms-webhook`;
  const params  = parseBody(event.body);

  if (!validateTwilioSignature(authToken, twilioSignature, fullUrl, params)) {
    console.warn('Invalid Twilio signature — request rejected');
    return { statusCode: 403, body: 'Forbidden' };
  }

  const fromNumber = params.From || '';
  const rawBody    = (params.Body || '').trim().toUpperCase();
  const keyword    = rawBody.split(' ')[0]; // first word only

  const supabase = createClient(supabaseUrl, supabaseKey);

  let replyMessage = '';

  if (OPT_IN_KEYWORDS.includes(keyword)) {
    // Upsert opt-in record
    const { error } = await supabase
      .from('sms_subscribers')
      .upsert(
        { phone: fromNumber, opted_in: true, opted_in_at: new Date().toISOString(), opted_out_at: null },
        { onConflict: 'phone' }
      );

    if (error) console.error('Supabase opt-in error:', error);
    replyMessage = MESSAGES.optIn;

  } else if (OPT_OUT_KEYWORDS.includes(keyword)) {
    // Mark opted out
    const { error } = await supabase
      .from('sms_subscribers')
      .upsert(
        { phone: fromNumber, opted_in: false, opted_out_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );

    if (error) console.error('Supabase opt-out error:', error);
    replyMessage = MESSAGES.optOut;

  } else if (HELP_KEYWORDS.includes(keyword)) {
    replyMessage = MESSAGES.help;

  } else {
    // Unknown keyword — send help
    replyMessage = MESSAGES.help;
  }

  // Respond with TwiML so Twilio sends the reply SMS
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyMessage}</Message>
</Response>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: twiml,
  };
};
