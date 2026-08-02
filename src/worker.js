// Cloudflare Worker — gauravmundra.com
//
// Routes:
//   GET  /api/sync-articles  → manual trigger for LinkedIn article sync
//   GET  /*                  → static assets from /public
//
// Cron: every Sunday at midnight UTC (0 0 * * 0)
//   → fetches published LinkedIn posts from Typefully
//   → updates articles.json in GitHub repo
//   → Cloudflare auto-redeploys on repo change → site updates
//
// Required environment secrets (Cloudflare → Settings → Variables and Secrets):
//   TYPEFULLY_API_KEY  — Typefully API v2 key (Typefully → Settings → API)
//   GITHUB_TOKEN       — GitHub personal access token (repo: contents write)
//   GITHUB_REPO        — e.g. "gauravmundra/gauravmundra-website"  (type: Text)

const TYPEFULLY_SOCIAL_SET_ID = 319960;
const ARTICLES_PATH           = 'public/articles.json';

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync-articles') {
      const result = await syncArticles(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env) {
    await syncArticles(env);
  }
};

// ─── TYPEFULLY → GITHUB SYNC ─────────────────────────────────────────────────

async function syncArticles(env) {
  if (!env.TYPEFULLY_API_KEY) return { error: 'TYPEFULLY_API_KEY not set' };
  if (!env.GITHUB_TOKEN)      return { error: 'GITHUB_TOKEN not set' };
  if (!env.GITHUB_REPO)       return { error: 'GITHUB_REPO not set' };

  // 1. Fetch published drafts from Typefully
  // Typefully API v2 — v1 was retired 15 June 2026.
  // Auth is Authorization: Bearer, and drafts are scoped to a social set.
  const tfUrl =
    `https://api.typefully.com/v2/social-sets/${TYPEFULLY_SOCIAL_SET_ID}/drafts` +
    `?status=published&order_by=-published_at&limit=50`;

  const tfRes = await fetch(tfUrl, {
    headers: { Authorization: `Bearer ${env.TYPEFULLY_API_KEY}` }
  });

  if (!tfRes.ok) {
    let detail = '';
    try { detail = JSON.stringify(await tfRes.json()); } catch (_) {}
    return { error: `Typefully error: ${tfRes.status}`, detail };
  }

  const drafts = (await tfRes.json()).results || [];

  // 2. Filter to LinkedIn-only posts with a published URL
  const posts = drafts.filter(d =>
    d.linkedin_post_enabled &&
    d.linkedin_published_url &&
    d.linkedin_post_published_at
  );

  if (!posts.length) return { message: 'No LinkedIn posts found', added: 0 };

  // 3. Fetch current articles.json from GitHub
  const ghBase    = `https://api.github.com/repos/${env.GITHUB_REPO}`;
  const ghHeaders = {
    Authorization:  `Bearer ${env.GITHUB_TOKEN}`,
    Accept:         'application/vnd.github+json',
    'User-Agent':   'gauravmundra-worker'
  };

  const fileRes = await fetch(`${ghBase}/contents/${ARTICLES_PATH}`, { headers: ghHeaders });
  let existing = [];
  let fileSha  = null;

  if (fileRes.ok) {
    const fd   = await fileRes.json();
    fileSha    = fd.sha;
    existing   = JSON.parse(atob(fd.content.replace(/\n/g, ''))).articles || [];
  }

  // 4. Find new posts
  const existingIds = new Set(existing.map(a => a.id));
  const added = posts
    .filter(d => !existingIds.has(d.id))
    .map(d => ({
      id:           d.id,
      title:        cleanTitle(d.draft_title),
      excerpt:      d.preview || '',
      url:          d.linkedin_published_url,
      published_at: d.linkedin_post_published_at
    }));

  if (!added.length) return { message: 'All posts already synced', added: 0 };

  // 5. Merge, sort, push back to GitHub
  const merged = [...added, ...existing]
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  const body = {
    message: `Sync ${added.length} new LinkedIn article(s)`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify({ articles: merged }, null, 2)))),
    ...(fileSha ? { sha: fileSha } : {})
  };

  const pushRes = await fetch(`${ghBase}/contents/${ARTICLES_PATH}`, {
    method:  'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  if (!pushRes.ok) {
    const err = await pushRes.json();
    return { error: `GitHub push failed: ${err.message}` };
  }

  return { message: 'Sync complete', added: added.length, titles: added.map(a => a.title) };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// "PM: Full-Stack PM Advice (LinkedIn)" → "Full-Stack PM Advice"
function cleanTitle(raw) {
  if (!raw) return 'Untitled';
  return raw
    .replace(/\s*\([^)]*\)\s*$/, '')   // strip trailing (LinkedIn), (X thread) etc.
    .replace(/^[^:]+:\s*/, '')          // strip leading "PM: " category prefix
    .trim() || raw;
}
