// Cloudflare Worker — replaces the old /functions/api/photos.js approach.
// This is the modern "Workers with static assets" model. The dashboard
// can now attach environment variables/secrets because this file gives
// the project an actual running script (main), not just static files.
//
// Set GOOGLE_API_KEY in: Dashboard → your project → Settings →
// Variables and Secrets → Add (Type: Secret).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/photos') {
      return handlePhotos(request, env);
    }

    // Everything else falls through to the static files in /public
    return env.ASSETS.fetch(request);
  }
};

async function handlePhotos(request, env) {
  const url      = new URL(request.url);
  const folderId = url.searchParams.get('folderId');
  const count    = url.searchParams.get('count') || '9';

  if (!folderId) {
    return jsonResponse({ error: 'Missing folderId parameter' }, 400);
  }

  if (!env.GOOGLE_API_KEY) {
    return jsonResponse({ error: 'Server misconfigured: GOOGLE_API_KEY not set' }, 500);
  }

  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`
  );

  const driveUrl =
    `https://www.googleapis.com/drive/v3/files` +
    `?q=${q}` +
    `&fields=files(id,name,createdTime)` +
    `&orderBy=createdTime+desc` +
    `&pageSize=${count}` +
    `&key=${env.GOOGLE_API_KEY}`;

  try {
    const res  = await fetch(driveUrl);
    const data = await res.json();

    if (!res.ok) {
      return jsonResponse({ error: data.error?.message || 'Drive API error' }, res.status);
    }

    return jsonResponse(data, 200, { 'Cache-Control': 'public, max-age=300' });

  } catch (err) {
    return jsonResponse({ error: 'Failed to reach Google Drive API' }, 502);
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}
