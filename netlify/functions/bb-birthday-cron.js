// Scheduled daily at 9:00 AM UTC — sends birthday SMS to all contacts whose
// birthday month/day matches today and haven't been sent to this calendar year.

const { schedule }    = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');
const twilio           = require('twilio');

const handler = async () => {
  const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  const now   = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(now.getUTCDate()).padStart(2, '0');
  const year  = now.getUTCFullYear();

  // Get all contacts whose birthday is today, not yet sent this year
  const { data: contacts, error } = await svc
    .from('bb_contacts')
    .select('*')
    .filter('birthday', 'like', `%-${month}-${day}`);

  if (error) { console.error('Failed to fetch contacts:', error.message); return { statusCode: 500 }; }

  // Filter out already-sent-this-year
  const { data: sentThisYear } = await svc
    .from('bb_send_log')
    .select('contact_id')
    .eq('year', year)
    .is('error', null);

  const sentIds = new Set((sentThisYear || []).map(r => r.contact_id));
  const toSend  = (contacts || []).filter(c => !sentIds.has(c.id));

  console.log(`Birthday cron: ${toSend.length} message(s) to send for ${month}/${day}/${year}`);

  for (const contact of toSend) {
    try {
      const msg = await twilioClient.messages.create({
        body: contact.message,
        from: process.env.TWILIO_FROM_NUMBER,
        to:   contact.phone_number,
      });
      await svc.from('bb_send_log').upsert(
        { contact_id: contact.id, year, message_body: contact.message, error: null, sent_at: new Date().toISOString() },
        { onConflict: 'contact_id,year' }
      );
      await svc.from('bb_send_attempts').insert({
        contact_id: contact.id, trigger: 'scheduled', success: true,
        message_body: contact.message, twilio_sid: msg.sid,
      });
      console.log(`Sent to ${contact.first_name} ${contact.last_name} (${contact.phone_number})`);
    } catch (err) {
      await svc.from('bb_send_log').upsert(
        { contact_id: contact.id, year, message_body: contact.message, error: err.message, sent_at: new Date().toISOString() },
        { onConflict: 'contact_id,year' }
      );
      await svc.from('bb_send_attempts').insert({
        contact_id: contact.id, trigger: 'scheduled', success: false,
        message_body: contact.message, error: err.message,
      });
      console.error(`Failed to send to ${contact.phone_number}:`, err.message);
    }
  }

  return { statusCode: 200 };
};

exports.handler = schedule('0 9 * * *', handler);
