// Cloudflare Email Routing Worker for QuizSolver support inbox.
// You can either fill SUPPORT_SECRET below, or set Worker variables:
// QUIZSOLVER_SUPPORT_WEBHOOK=https://getquizsolver.com/api/support/inbound
// QUIZSOLVER_SUPPORT_SECRET=<same value as SUPPORT_INBOUND_SECRET on the VPS>

const SUPPORT_WEBHOOK = 'https://getquizsolver.com/api/support/inbound';
const SUPPORT_SECRET = 'WPISZ_TUTAJ_SECRET_TAKI_SAM_JAK_NA_VPS';

function decodeMimeWords(value = '') {
  return String(value).replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        return new TextDecoder(charset || 'utf-8').decode(bytes);
      }
      const qp = encoded.replace(/_/g, ' ').replace(/=([A-Fa-f0-9]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
      const bytes = Uint8Array.from(qp, c => c.charCodeAt(0));
      return new TextDecoder(charset || 'utf-8').decode(bytes);
    } catch {
      return encoded;
    }
  });
}

function decodeQuotedPrintable(value = '') {
  const binary = String(value)
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  try {
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return binary;
  }
}

function decodeTransferBody(body = '', encoding = '') {
  const normalizedEncoding = String(encoding || '').toLowerCase();
  if (normalizedEncoding.includes('quoted-printable')) return decodeQuotedPrintable(body);
  if (normalizedEncoding.includes('base64')) {
    try {
      const clean = String(body).replace(/\s+/g, '');
      const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return body;
    }
  }
  return body;
}

function parseHeaders(block = '') {
  const headers = {};
  let current = '';
  for (const line of String(block).split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    current = match[1].toLowerCase();
    headers[current] = match[2].trim();
  }
  return headers;
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function trimQuotedReply(text = '') {
  return String(text)
    .split(/\nOn .+ wrote:\n/i)[0]
    .split(/\nW dniu .+ napisał\(a\):\n/i)[0]
    .split(/\n-+Original Message-+/i)[0]
    .split(/\nOd: .+\nWysłano:/i)[0]
    .trim();
}

function parseMime(raw = '', contentType = '') {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  const [rawHeaderBlock, ...bodyParts] = normalized.split(/\n\n/);
  const rootHeaders = parseHeaders(rawHeaderBlock);
  const rootContentType = contentType || rootHeaders['content-type'] || '';
  const rawBody = bodyParts.join('\n\n');
  const boundary = rootContentType.match(/boundary="?([^";]+)"?/i)?.[1];

  const parts = boundary
    ? rawBody.split(`--${boundary}`).filter(part => part.trim() && !part.trim().startsWith('--'))
    : [normalized];

  let plain = '';
  let html = '';

  for (const part of parts) {
    const [partHeaderBlock, ...partBodyParts] = part.replace(/^\n+/, '').split(/\n\n/);
    const headers = parseHeaders(partHeaderBlock);
    const body = partBodyParts.join('\n\n').trim();
    const decoded = decodeTransferBody(body, headers['content-transfer-encoding']);
    const type = String(headers['content-type'] || rootContentType).toLowerCase();
    if (!plain && type.includes('text/plain')) plain = decoded.trim();
    if (!html && type.includes('text/html')) html = decoded.trim();
  }

  if (!plain && html) plain = stripHtml(html);
  if (!html && plain) html = `<p>${plain.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])).replace(/\n/g, '<br>')}</p>`;

  return {
    text: trimQuotedReply(plain || rawBody || normalized).slice(0, 20000),
    html: (html || '').slice(0, 50000)
  };
}

async function sendToQuizSolver(payload, env) {
  const webhook = env.QUIZSOLVER_SUPPORT_WEBHOOK || SUPPORT_WEBHOOK;
  const secret = env.QUIZSOLVER_SUPPORT_SECRET || SUPPORT_SECRET;
  if (!secret || secret.includes('WPISZ_TUTAJ')) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Worker secret is not configured. Fill SUPPORT_SECRET or QUIZSOLVER_SUPPORT_SECRET.'
    }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-support-secret': secret
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  console.log(`QuizSolver support webhook -> ${response.status}: ${body.slice(0, 300)}`);
  return new Response(body, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'GET') {
      return new Response('QuizSolver support email worker is running.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const body = await request.json().catch(() => ({}));
    return sendToQuizSolver({
      fromEmail: body.fromEmail || 'preview@test.local',
      fromName: body.fromName || 'Preview Test',
      toEmail: body.toEmail || 'support@getquizsolver.com',
      subject: body.subject || 'Worker preview test',
      text: body.text || 'Manual test from Cloudflare Worker Preview.',
      html: body.html || '',
      source: 'cloudflare-email-worker',
      messageId: body.messageId || `preview-${Date.now()}`,
      inReplyTo: body.inReplyTo || '',
      references: body.references || ''
    }, env);
  },

  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();
    const parsed = parseMime(raw, message.headers.get('content-type') || '');
    const fromHeader = decodeMimeWords(message.headers.get('from') || message.from || '');
    const fromName = fromHeader.replace(/<[^>]+>/g, '').replace(/"/g, '').trim();

    const payload = {
      fromEmail: message.from,
      fromName,
      toEmail: message.to,
      subject: decodeMimeWords(message.headers.get('subject') || '(No subject)'),
      text: parsed.text,
      html: parsed.html,
      raw: raw.slice(0, 5000),
      source: 'cloudflare-email-worker',
      messageId: message.headers.get('message-id') || '',
      inReplyTo: message.headers.get('in-reply-to') || '',
      references: message.headers.get('references') || ''
    };

    const response = await sendToQuizSolver(payload, env);
    if (!response.ok) {
      console.error(`QuizSolver support webhook failed with ${response.status}`);
    }
  }
};
