// Create, update, or delete a project — requires admin auth
// POST   { action:'create', client_id, name, description, status, milestones, links, notes, cover_color }
// POST   { action:'update', id, ...fields }
// POST   { action:'delete', id }

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  const anonKey     = process.env.SUPABASE_ANON_KEY;

  // Verify caller is admin
  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: profiles } = await adminClient.from('profiles').select('role').eq('id', user.id);
  const profile = profiles?.[0];
  if (!profile || profile.role !== 'admin') return { statusCode: 403, body: 'Forbidden' };

  const body = JSON.parse(event.body || '{}');
  const { action } = body;

  if (action === 'create') {
    const { client_id, name, description, status, milestones, links, notes, cover_color } = body;
    if (!client_id || !name) return { statusCode: 400, body: 'client_id and name required' };
    const { data, error } = await adminClient.from('projects').insert({
      client_id, name,
      description: description || null,
      status:      status      || 'planning',
      milestones:  milestones  || [],
      links:       links       || [],
      notes:       notes       || null,
      cover_color: cover_color || '#00bcd4',
      updated_at:  new Date().toISOString(),
    }).select().single();
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  if (action === 'update') {
    const { id, ...fields } = body;
    if (!id) return { statusCode: 400, body: 'id required' };
    delete fields.action;
    fields.updated_at = new Date().toISOString();
    const { data, error } = await adminClient.from('projects').update(fields).eq('id', id).select().single();
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  if (action === 'delete') {
    const { id } = body;
    if (!id) return { statusCode: 400, body: 'id required' };
    const { error } = await adminClient.from('projects').delete().eq('id', id);
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: 'deleted' };
  }

  return { statusCode: 400, body: 'Unknown action' };
};
