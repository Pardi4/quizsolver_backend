// Cloudflare Email Routing Worker example.
// Add a Worker route for support@getquizsolver.com and set these Worker variables:
// QUIZSOLVER_SUPPORT_WEBHOOK=https://getquizsolver.com/api/support/inbound
// QUIZSOLVER_SUPPORT_SECRET=<same value as SUPPORT_INBOUND_SECRET on the VPS>
//
// For cleaner MIME parsing, install/import `postal-mime` in the Worker project.

export default {
  async email(message, env, ctx) {
    const subject = message.headers.get('subject') || '(No subject)';
    const fromName = (message.headers.get('from') || message.from || '').replace(/<[^>]+>/g, '').trim();
    const rawText = await new Response(message.raw).text();

    const payload = {
      fromEmail: message.from,
      fromName,
      toEmail: message.to,
      subject,
      text: rawText.slice(0, 20000),
      source: 'cloudflare-email-worker',
      messageId: message.headers.get('message-id') || ''
    };

    ctx.waitUntil(fetch(env.QUIZSOLVER_SUPPORT_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-support-secret': env.QUIZSOLVER_SUPPORT_SECRET
      },
      body: JSON.stringify(payload)
    }));
  }
};
