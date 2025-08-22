// /api/ping.js
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  // CORS básico
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN || '';
    const env = process.env.VERCEL_ENV || 'unknown';

    // Prueba de escritura en el Blob Store
    let writeTest = { ok: false, url: null, error: null };
    try {
      const r = await put(
        `mora2/healthcheck_${Date.now()}.txt`,
        'ok',
        { access: 'public', token } // <<< usa el token del entorno
      );
      writeTest = { ok: true, url: r.url };
    } catch (e) {
      writeTest = { ok: false, error: e?.message || String(e) };
    }

    return res.status(200).json({
      ok: true,
      env,
      tokenInfo: { present: !!token, length: token.length },
      writeTest,
      time: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
