export const config = {
  runtime: 'nodejs20.x',
  regions: ['iad1'],
  maxDuration: 10
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, time: new Date().toISOString() });
}
