const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const { postId } = JSON.parse(event.body || '{}');
  if (!postId) return { statusCode: 400, body: 'postId required' };

  const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: post, error: postErr } = await svc.from('craftivity_posts').select('*').eq('id', postId).single();
  if (postErr || !post) return { statusCode: 404, body: 'Post not found' };
  if (post.client_id !== user.id) return { statusCode: 403, body: 'Forbidden' };
  if (!post.image_prompt) return { statusCode: 400, body: 'No image prompt on this post' };

  try {
    // Generate image via DALL-E 3
    const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: post.image_prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    });

    if (!dalleRes.ok) throw new Error(`DALL-E error: ${await dalleRes.text()}`);
    const dalleData = await dalleRes.json();
    const tempUrl = dalleData.data[0].url;

    // Download image from the temporary DALL-E URL
    const imgRes = await fetch(tempUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    // Upload to Supabase Storage
    const fileName = `${postId}.png`;
    const { error: uploadErr } = await svc.storage
      .from('craftivity-images')
      .upload(fileName, imgBuffer, { contentType: 'image/png', upsert: true });

    if (uploadErr) throw new Error(`Storage upload error: ${uploadErr.message}`);

    const { data: { publicUrl } } = svc.storage.from('craftivity-images').getPublicUrl(fileName);

    // Update post with permanent image URL
    await svc.from('craftivity_posts').update({
      image_url: publicUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', postId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: publicUrl }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
