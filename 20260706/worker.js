// Cloudflare Worker — static asset passthrough only.
// The old /api/photos (Google Drive gallery) endpoint has been removed;
// the redesigned site no longer pulls photos from Drive, so no
// GOOGLE_API_KEY / secret is needed anymore.

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
