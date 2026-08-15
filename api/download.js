const ALLOWED_HOSTS = ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'];

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 20;
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  hits.set(ip, entry);
  return entry.count > max;
}

function isValidTikTokUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  return ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
}

function sanitizeUrl(rawUrl) {
  return rawUrl.trim().replace(/[\u0000-\u001F\u007F<>"']/g, '');
}

module.exports = async (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas peticiones. Espera unos minutos.' });
  }

  const { url } = req.body || {};
  if (!isValidTikTokUrl(url)) {
    return res.status(400).json({ error: 'El link no es una URL válida de TikTok.' });
  }
  const cleanUrl = sanitizeUrl(url);

  try {
    const providerUrl = 'https://www.tikwm.com/api/?url=' + encodeURIComponent(cleanUrl) + '&hd=1';
    const upstream = await fetch(providerUrl);
    if (!upstream.ok) throw new Error('upstream-error');

    const data = await upstream.json();
    if (data.code !== 0 || !data.data) {
      return res.status(422).json({ error: 'No se pudo procesar ese video. Revisa que sea público.' });
    }

    const { title, author, play, hdplay } = data.data;
    return res.status(200).json({
      title: typeof title === 'string' ? title.slice(0, 200) : '',
      author: author?.unique_id || author?.nickname || '',
      videoUrl: hdplay || play,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Error al contactar el servicio de descarga. Intenta de nuevo.' });
  }
};
