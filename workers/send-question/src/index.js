export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ── Admin endpoints (authenticated) ─────────────────────────────────
    if (url.pathname === '/questions' || url.pathname.startsWith('/questions/')) {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token || token !== env.ADMIN_API_KEY) {
        return jsonResponse(401, { error: 'Unauthorized' }, request);
      }

      // GET /questions — list all pending questions
      if (request.method === 'GET' && url.pathname === '/questions') {
        const list = await listQuestions(env);
        return jsonResponse(200, list, request);
      }

      // DELETE /questions/:id — delete a question from KV
      if (request.method === 'DELETE' && url.pathname.startsWith('/questions/')) {
        const id = url.pathname.replace('/questions/', '');
        await env.FATWA_QUESTIONS.delete(id);
        return jsonResponse(200, { success: true }, request);
      }

      return jsonResponse(405, { error: 'Method not allowed' }, request);
    }

    // ── Public submission endpoint ──────────────────────────────────────
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' }, request);
    }

    let args;
    try {
      args = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON' }, request);
    }

    if (args._gotcha) {
      return jsonResponse(200, { success: true }, request);
    }

    const turnstileToken = args['cf-turnstile-response'];
    if (!turnstileToken) {
      return jsonResponse(400, { error: 'Missing captcha' }, request);
    }

    const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
      }),
    });
    const turnstileData = await turnstileRes.json();
    if (!turnstileData.success) {
      return jsonResponse(403, { error: 'Captcha verification failed' }, request);
    }

    const { name, email, title, message, dryRun } = args;
    if (!name || !email || !title || !message) {
      return jsonResponse(400, { error: 'Missing fields' }, request);
    }

    const notifyTo = dryRun ? env.NOTIFY_EMAIL_DEV : env.NOTIFY_EMAIL_PRIMARY;
    console.log('dryRun:', dryRun, '| notifyTo:', notifyTo);

    const resendHeaders = {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    };

    try {
      const notifyRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: resendHeaders,
        body: JSON.stringify({
          from: 'موقع الشيخ إبراهيم الزعابي <noreply@notifications.ebrahimalzaabi.com>',
          to: notifyTo,
          bcc: env.NOTIFY_EMAIL_DEV,
          subject: `سؤال جديد: ${title}`,
          html: buildNotifyEmail(name, email, title, message),
        }),
      });
      if (!notifyRes.ok) {
        console.error('Resend notify error:', await notifyRes.text());
        return jsonResponse(500, { error: 'Failed to send notification' }, request);
      }

      const confirmRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: resendHeaders,
        body: JSON.stringify({
          from: 'موقع الشيخ إبراهيم الزعابي <noreply@notifications.ebrahimalzaabi.com>',
          to: email,
          subject: `تم استلام سؤالك: ${title}`,
          html: buildConfirmEmail(name, title, message),
        }),
      });
      if (!confirmRes.ok) {
        console.error('Resend confirm error:', await confirmRes.text());
        return jsonResponse(500, { error: 'Failed to send confirmation' }, request);
      }

      // Store question in KV for admin retrieval
      try {
        const now = new Date();
        const kvId = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
        await env.FATWA_QUESTIONS.put(kvId, JSON.stringify({
          name, email, title, message,
          date: now.toISOString().slice(0, 10),
          submittedAt: now.toISOString(),
        }));
        console.log('Stored question in KV:', kvId);
      } catch (kvErr) {
        // Non-fatal: email was already sent, just log the KV error
        console.error('KV store error (non-fatal):', kvErr);
      }

      return jsonResponse(200, { success: true }, request);
    } catch (err) {
      console.error('Resend error:', err);
      return jsonResponse(500, { error: 'Failed to send' }, request);
    }
  },
};

// ── KV helpers ──────────────────────────────────────────────────────────────

async function listQuestions(env) {
  const keys = await env.FATWA_QUESTIONS.list();
  const questions = [];
  for (const key of keys.keys) {
    const val = await env.FATWA_QUESTIONS.get(key.name);
    if (val) {
      try {
        questions.push({ id: key.name, ...JSON.parse(val) });
      } catch { /* skip malformed entries */ }
    }
  }
  // Sort newest first
  questions.sort((a, b) => b.id.localeCompare(a.id));
  return questions;
}

const ALLOWED_ORIGINS = [
  'https://ebrahimalzaabi.com',
  'http://localhost:1313',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(status, body, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function buildEmailShell(badgeHtml, bodyHtml) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Geeza Pro','Al Nile','Traditional Arabic','Simplified Arabic','Arial',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#C5A059 0%,#a8864a 100%);padding:30px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,0.2);">
                موقع الشيخ إبراهيم سيف الزعابي
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 40px 20px;text-align:center;">
              ${badgeHtml}
            </td>
          </tr>
          ${bodyHtml}
          <tr>
            <td style="background:#f8f9fa;padding:25px 40px;text-align:center;border-top:1px solid #eee;">
              <p style="margin:0 0 10px;color:#888;font-size:14px;">جزاكم الله خيراً</p>
              <a href="https://ebrahimalzaabi.com" style="color:#C5A059;text-decoration:none;font-size:14px;font-weight:600;">ebrahimalzaabi.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildNotifyEmail(name, email, title, message) {
  const badge = `<div style="display:inline-block;background:#e3f2fd;border:2px solid #1976d2;border-radius:50px;padding:12px 30px;">
    <span style="color:#1565c0;font-size:18px;font-weight:600;">📩 سؤال شرعي جديد</span>
  </div>`;
  const body = `
    <tr><td style="padding:10px 40px 20px;text-align:center;">
      <h2 style="margin:0;color:#2c3e50;font-size:22px;line-height:1.6;font-weight:700;">${title}</h2>
    </td></tr>
    <tr><td style="padding:0 40px 15px;">
      <div style="background:#fdf8f0;border-right:4px solid #C5A059;border-radius:8px;padding:20px 25px;text-align:right;direction:rtl;">
        <p style="margin:0 0 10px;color:#C5A059;font-size:14px;font-weight:600;">السؤال:</p>
        <p style="margin:0;color:#555;font-size:16px;line-height:1.8;">${message}</p>
      </div>
    </td></tr>
    <tr><td style="padding:0 40px 25px;">
      <div style="background:#f5f5f5;border-radius:8px;padding:15px 25px;text-align:right;direction:rtl;">
        <p style="margin:0 0 5px;color:#888;font-size:14px;"><strong>الاسم:</strong> ${name}</p>
        <p style="margin:0;color:#888;font-size:14px;"><strong>البريد:</strong> ${email}</p>
      </div>
    </td></tr>`;
  return buildEmailShell(badge, body);
}

function buildConfirmEmail(name, title, message) {
  const badge = `<div style="display:inline-block;background:#e8f5e9;border:2px solid #4caf50;border-radius:50px;padding:12px 30px;">
    <span style="color:#2e7d32;font-size:18px;font-weight:600;">✓ تم استلام سؤالك</span>
  </div>`;
  const body = `
    <tr><td style="padding:10px 40px 20px;text-align:center;">
      <h2 style="margin:0;color:#2c3e50;font-size:22px;line-height:1.6;font-weight:700;">${title}</h2>
    </td></tr>
    <tr><td style="padding:0 40px 15px;">
      <div style="background:#fdf8f0;border-right:4px solid #C5A059;border-radius:8px;padding:20px 25px;text-align:right;direction:rtl;">
        <p style="margin:0 0 10px;color:#C5A059;font-size:14px;font-weight:600;">السؤال:</p>
        <p style="margin:0;color:#555;font-size:16px;line-height:1.8;">${message}</p>
      </div>
    </td></tr>
    <tr><td style="padding:0 40px 30px;text-align:center;">
      <p style="margin:0;color:#555;font-size:16px;line-height:1.8;">
        السلام عليكم ${name}،<br>
        ملاحظة: لا نضمن الإجابة على الأسئلة حيث يتم الإجابة عليها بحسب وقت الشيخ<br>
        سيصلك بريد إلكتروني عند نشر الإجابة.
      </p>
    </td></tr>`;
  return buildEmailShell(badge, body);
}