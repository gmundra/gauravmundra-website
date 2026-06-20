// Cloudflare Pages Function
// Lives at: /functions/api/photos.js
// Becomes available at: https://yourdomain.com/api/photos
//
// This runs server-side. The Google API key never reaches the browser.
// Set GOOGLE_API_KEY as an environment variable in the Cloudflare Pages
// dashboard (Settings → Environment variables) — never write it in this file.

export async function onRequestGet({ request, env }) {
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

    // Cache for 5 minutes — reduces calls to Google, speeds up repeat visits
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
