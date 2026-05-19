// Invite a new client by email — requires admin auth
// POST { email, full_name, company }

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  const anonKey     = process.env.SUPABASE_ANON_KEY;

  // Verify caller is an authenticated admin
  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: profiles } = await adminClient.from('profiles').select('role').eq('id', user.id);
  const profile = profiles?.[0];
  if (!profile || profile.role !== 'admin') return { statusCode: 403, body: 'Forbidden' };

  const { email, full_name, company } = JSON.parse(event.body || '{}');
  if (!email) return { statusCode: 400, body: 'Email required' };

  // Invite user via Supabase Auth
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name, company },
    redirectTo: 'https://jjaiservices.com/client-portal.html',
  });
  if (inviteErr) return { statusCode: 400, body: JSON.stringify({ error: inviteErr.message }) };

  // Create profile record
  await adminClient.from('profiles').upsert({
    id:        invited.user.id,
    role:      'client',
    full_name: full_name || '',
    company:   company  || '',
  }, { onConflict: 'id' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: invited.user.id, email }),
  };
};
