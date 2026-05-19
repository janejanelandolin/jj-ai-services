// GET  — list contacts for the authenticated user (admins see all)
// POST — create a single contact

const { createClient } = require('@supabase/supabase-js');

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

async function getClients(event) {
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey    = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  const { data: { user }, error } = await createClient(supabaseUrl, anonKey).auth.getUser(token);
  if (error || !user) return { statusCode: 401, body: 'Unauthorized' };

  const svc = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await svc.from('profiles').select('role').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin';

  return { user, svc, isAdmin };
}

exports.handler = async (event) => {
  const auth = await getClients(event);
  if (auth.statusCode) return auth;
  const { user, svc, isAdmin } = auth;

  if (event.httpMethod === 'GET') {
    let q = svc
      .from('bb_contacts')
      .select('*, bb_send_log(year, sent_at, message_body, error)')
      .order('created_at', { ascending: false });
    if (!isAdmin) q = q.eq('client_id', user.id);

    const { data, error } = await q;
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };

    const contacts = (data || []).map(c => {
      const logs = (c.bb_send_log || []).sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
      const latest = logs[0];
      const { bb_send_log, ...rest } = c;
      return {
        ...rest,
        sent_at:      latest?.sent_at      || null,
        sent_message: latest?.message_body || null,
        send_error:   latest?.error        || null,
        sent_year:    latest?.year         || null,
      };
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contacts) };
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { first_name, last_name, birthday, phone_number, message } = body;

    if (!first_name || !last_name || !birthday || !phone_number)
      return { statusCode: 400, body: JSON.stringify({ error: 'first_name, last_name, birthday, and phone_number are required' }) };

    const client_id  = (isAdmin && body.client_id) ? body.client_id : user.id;
    const finalMsg   = message?.trim() || `Happy Birthday ${first_name.trim()}! 🎂 - from your friends at LAB Wealth Management`;

    const { data, error } = await svc.from('bb_contacts').insert({
      client_id,
      first_name:   first_name.trim(),
      last_name:    last_name.trim(),
      birthday,
      phone_number: normalizePhone(phone_number),
      message:      finalMsg,
    }).select().single();

    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
