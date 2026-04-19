// Health check module for the send-question worker.
// Validates: Resend API + domain, Turnstile siteverify, KV store.

const SENDING_DOMAIN = 'notifications.ebrahimalzaabi.com';

export async function handleHealthCheck(env) {
  const checks = {
    worker: { ok: true },
    resend: await checkResend(env),
    turnstile: await checkTurnstile(env),
    kv: await checkKV(env),
  };

  const resendOk = checks.resend.ok;
  const allOk = resendOk && checks.turnstile.ok && checks.kv.ok;

  const status = allOk ? 'healthy' : resendOk ? 'degraded' : 'unhealthy';

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
  };
}

// -- Resend: GET /domains, verify our sending domain is active ----------------

async function checkResend(env) {
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Resend API ${res.status}: ${text}` };
    }

    const body = await res.json();
    const domains = body.data || [];
    const domain = domains.find((d) => d.name === SENDING_DOMAIN);

    if (!domain) {
      return { ok: false, error: `Domain ${SENDING_DOMAIN} not found in Resend account` };
    }

    const sendingEnabled = domain.capabilities?.sending === 'enabled';
    const verified = domain.status === 'verified';

    if (!verified || !sendingEnabled) {
      return {
        ok: false,
        domain: SENDING_DOMAIN,
        domainStatus: domain.status,
        sending: domain.capabilities?.sending || 'unknown',
        error: 'Domain is not verified or sending is not enabled',
      };
    }

    return {
      ok: true,
      domain: SENDING_DOMAIN,
      domainStatus: domain.status,
      sending: domain.capabilities.sending,
    };
  } catch (err) {
    return { ok: false, error: `Resend unreachable: ${err.message}` };
  }
}

// -- Turnstile: siteverify with real secret + empty token ---------------------
// A success:false with error "missing-input-response" proves the API is up
// and the secret key is recognized. An invalid secret would return
// "invalid-input-secret" instead.

const TURNSTILE_HEALTHY_ERROR = 'missing-input-response';

async function checkTurnstile(env) {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: '',
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `Turnstile API ${res.status}` };
    }

    const data = await res.json();

    // We expect success:false with "missing-input-response" — that means
    // the API is reachable AND our secret key is valid.
    if (!data.success && data['error-codes']?.includes(TURNSTILE_HEALTHY_ERROR)) {
      return { ok: true };
    }

    // If we get "invalid-input-secret", the key is broken.
    if (data['error-codes']?.includes('invalid-input-secret')) {
      return { ok: false, error: 'Turnstile secret key is invalid' };
    }

    // Any other unexpected response
    return { ok: false, error: `Unexpected response: ${JSON.stringify(data)}` };
  } catch (err) {
    return { ok: false, error: `Turnstile unreachable: ${err.message}` };
  }
}

// -- KV: list questions to verify the binding works ---------------------------

async function checkKV(env) {
  try {
    const list = await env.FATWA_QUESTIONS.list({ limit: 1 });
    return { ok: true, questionCount: list.keys.length > 0 ? 'non-empty' : 'empty' };
  } catch (err) {
    return { ok: false, error: `KV error: ${err.message}` };
  }
}
