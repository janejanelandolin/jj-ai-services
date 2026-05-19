// POST { action: 'send' | 'delete' | 'attempts', id }
// send    — fire a Twilio SMS to this contact right now
// delete  — remove contact + all logs
// attempts — return the send_attempts history for a contact

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

async function getAuth(event) {
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const { data: { user }, error } = await createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY).auth.getUser(token);
  if (error || !user) return { statusCode: 401, body: 'Unauthorized' };

  const svc = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_KEY);
  const { data: profile } = await svc.from('profiles').select('role').eq('id', user.id).single();
  return { user, svc, isAdmin: profile?.role === 'admin' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = await getAuth(event);
  if (auth.statusCode) return auth;
  const { user, svc, isAdmin } = auth;

  const { action, id } = JSON.parse(event.body || '{}');
  if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };

  // Fetch contact — enforce ownership
  const { data: contact, error: cErr } = await svc.from('bb_contacts').select('*').eq('id', id).single();
  if (cErr || !contact) return { statusCode: 404, body: JSON.stringify({ error: 'Contact not found' }) };
  if (!isAdmin && contact.client_id !== user.id) return { statusCode: 403, body: 'Forbidden' };

  if (action === 'attempts') {
    const { data, error } = await svc
      .from('bb_send_attempts')
      .select('*')
      .eq('contact_id', id)
      .order('attempted_at', { ascending: false });
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  if (action === 'delete') {
    await svc.from('bb_send_attempts').delete().eq('contact_id', id);
    await svc.from('bb_send_log').delete().eq('contact_id', id);
    const { error } = await svc.from('bb_contacts').delete().eq('id', id);
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: JSON.stringify({ message: 'Contact deleted' }) };
  }

  if (action === 'send') {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const year = new Date().getFullYear();
    try {
      const msg = await twilioClient.messages.create({
        body: contact.message,
        from: process.env.TWILIO_FROM_NUMBER,
        to:   contact.phone_number,
      });
      await svc.from('bb_send_log').upsert(
        { contact_id: id, year, message_body: contact.message, error: null, sent_at: new Date().toISOString() },
        { onConflict: 'contact_id,year' }
      );
      await svc.from('bb_send_attempts').insert({
        contact_id: id, trigger: 'manual', success: true,
        message_body: contact.message, twilio_sid: msg.sid,
      });
      return { statusCode: 200, body: JSON.stringify({ message: `Message sent to ${contact.first_name} ${contact.last_name}` }) };
    } catch (err) {
      await svc.from('bb_send_log').upsert(
        { contact_id: id, year, message_body: contact.message, error: err.message, sent_at: new Date().toISOString() },
        { onConflict: 'contact_id,year' }
      );
      await svc.from('bb_send_attempts').insert({
        contact_id: id, trigger: 'manual', success: false,
        message_body: contact.message, error: err.message,
      });
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
