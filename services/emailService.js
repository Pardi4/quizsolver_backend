const nodemailer = require('nodemailer');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
const FROM_EMAIL = process.env.MAIL_FROM || process.env.SUPPORT_EMAIL || 'QuizSolver <support@getquizsolver.com>';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@getquizsolver.com';

let smtpTransport = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY || !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return smtpTransport;
}

function baseEmail({ title, hideTitle, preheader, body, ctaText, ctaUrl, footer }) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');
  const cta = ctaText && ctaUrl
    ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;margin-top:22px;padding:13px 18px;border-radius:10px;background:linear-gradient(135deg,#06b6d4,#8b5cf6);color:#ffffff;text-decoration:none;font-weight:800;">${escapeHtml(ctaText)}</a>`
    : '';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;background:#030712;color:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#030712;padding:32px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:linear-gradient(180deg,rgba(15,18,35,.96),rgba(10,14,27,.98));border:1px solid rgba(255,255,255,.08);border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.45);">
            <tr>
              <td style="padding:26px 28px;border-bottom:1px solid rgba(255,255,255,.08);">
                <div style="display:flex;align-items:center;gap:12px;">
                  <div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#06b6d4,#8b5cf6);display:inline-grid;place-items:center;text-align:center;line-height:42px;font-weight:900;letter-spacing:-.04em;color:white;box-shadow:0 14px 34px rgba(139,92,246,.28);">QS</div>
                  <div>
                    <div style="font-size:17px;font-weight:900;color:#f8fafc;">QuizSolver</div>
                    <div style="font-size:12px;color:#94a3b8;">${safePreheader}</div>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 34px;">
                ${hideTitle ? "" : `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;color:#f8fafc;">${safeTitle}</h1>`}
                <div style="font-size:15px;line-height:1.75;color:#cbd5e1;">${body}</div>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:rgba(255,255,255,.025);border-top:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.6;color:#64748b;">
                ${footer || `Sent by QuizSolver. Need help? Reply to this email or contact ${escapeHtml(SUPPORT_EMAIL)}.`}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function verificationTemplate({ code, email }) {
  const body = `
    <p style="margin:0 0 16px;">Use this verification code to finish creating your QuizSolver account for <strong style="color:#f8fafc;">${escapeHtml(email)}</strong>.</p>
    <div style="margin:22px 0;padding:18px 20px;border-radius:14px;background:rgba(6,182,212,.10);border:1px solid rgba(6,182,212,.28);font-size:32px;letter-spacing:.24em;text-align:center;color:#f8fafc;font-weight:900;">${escapeHtml(code)}</div>
    <p style="margin:0;color:#94a3b8;">The code expires in 15 minutes. If you did not create this account, you can ignore this email.</p>`;
  return {
    subject: 'Verify your QuizSolver account',
    text: `Your QuizSolver verification code is ${code}. It expires in 15 minutes.`,
    html: baseEmail({
      title: 'Verify your email',
      preheader: 'Finish creating your QuizSolver account',
      body
    })
  };
}

function resetPasswordTemplate({ code }) {
  const body = `
    <p style="margin:0 0 16px;">Use this code to set a new QuizSolver password.</p>
    <div style="margin:22px 0;padding:18px 20px;border-radius:14px;background:rgba(139,92,246,.11);border:1px solid rgba(139,92,246,.30);font-size:32px;letter-spacing:.24em;text-align:center;color:#f8fafc;font-weight:900;">${escapeHtml(code)}</div>
    <p style="margin:0;color:#94a3b8;">The code expires in 20 minutes. If you did not request this, you can ignore this message.</p>`;
  return {
    subject: 'Reset your QuizSolver password',
    text: `Your QuizSolver password reset code is ${code}. It expires in 20 minutes.`,
    html: baseEmail({
      title: 'Reset your password',
      preheader: 'Your secure reset code is inside',
      body
    })
  };
}

function welcomeTemplate({ email }) {
  const body = `
    <p style="margin:0 0 16px;">Welcome to QuizSolver! Your account for <strong style="color:#f8fafc;">${escapeHtml(email)}</strong> is ready.</p>
    <p style="margin:0 0 16px;">You can now use the Universal Parser™ to solve quizzes instantly. Simply install the Chrome Extension and pin it to your browser toolbar.</p>
    <div style="margin:24px 0;padding:16px;border-radius:12px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);text-align:center;">
      <p style="margin:0 0 8px;font-size:14px;color:#cbd5e1;">As a welcome gift, get 10% off your first credit top-up with code:</p>
      <div style="font-size:20px;font-weight:900;color:#f8fafc;letter-spacing:1px;">WELCOME10</div>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px;">
      <tr>
        <td style="border-radius:10px;background:linear-gradient(135deg,#06b6d4,#8b5cf6);">
          <a href="https://chrome.google.com/webstore/detail/quizsolver/your-extension-id" target="_blank" style="padding:13px 20px;display:inline-block;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">Download Chrome Extension</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#94a3b8;">If you need any help getting started, just reply to this email.</p>
  `;
  return {
    subject: 'Welcome to QuizSolver 🚀',
    text: 'Welcome to QuizSolver! Install our Chrome extension from the Web Store and start solving quizzes instantly. Use code WELCOME10 for 10% off your first top-up.',
    html: baseEmail({
      title: 'Welcome to QuizSolver',
      preheader: 'Your account is ready to go',
      body
    })
  };
}

function lowCreditsTemplate({ remaining }) {
  const body = `
    <p style="margin:0 0 16px;">Heads up! You are running low on QuizSolver credits.</p>
    <p style="margin:0 0 16px;">You currently have only <strong style="color:#f8fafc;font-size:18px;">${remaining}</strong> credits left. Make sure to top up before your next big quiz so you don't run out of AI answers mid-test.</p>
    <div style="margin:24px 0;padding:16px;border-radius:12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);text-align:center;">
      <p style="margin:0 0 8px;font-size:14px;color:#cbd5e1;">Special offer: Get 15% off your next refill with code:</p>
      <div style="font-size:20px;font-weight:900;color:#f8fafc;letter-spacing:1px;">LOW15</div>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px;">
      <tr>
        <td style="border-radius:10px;background:linear-gradient(135deg,#f59e0b,#ef4444);">
          <a href="${SITE_URL}/credits" target="_blank" style="padding:13px 20px;display:inline-block;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">Top up credits</a>
        </td>
      </tr>
    </table>
  `;
  return {
    subject: 'Low Credits Alert - Top up before your next quiz ⚠️',
    text: `You have ${remaining} QuizSolver credits left. Top up at ${SITE_URL}/credits so you don't run out during a test.`,
    html: baseEmail({
      title: 'Low Credits Warning',
      preheader: 'Don\'t run out mid-test!',
      body
    })
  };
}

function supportReplyTemplate({ message, replyText }) {
  const safeReplyHtml = escapeHtml(replyText).replace(/\n/g, '<br>');
  const originalSubject = message.subject || '(No subject)';
  const originalPreview = String(message.text || '').trim().substring(0, 900);
  const safeOriginalPreview = originalPreview
    ? escapeHtml(originalPreview).replace(/\n/g, '<br>')
    : 'No original message body was captured.';
  const body = `
    <p style="margin:0 0 18px;">Thanks for contacting QuizSolver support. Here is our reply:</p>
    <div style="margin:0 0 22px;padding:20px;border-radius:14px;background:#101827;border:1px solid rgba(6,182,212,.26);color:#f8fafc;font-size:16px;line-height:1.75;">${safeReplyHtml}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border-collapse:separate;border-spacing:0;background:rgba(255,255,255,.035);border:1px solid rgba(148,163,184,.18);border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.16);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;font-weight:800;">Original request</td>
      </tr>
      <tr>
        <td style="padding:16px;color:#cbd5e1;font-size:14px;line-height:1.65;">
          <div style="margin-bottom:10px;"><strong style="color:#f8fafc;">Subject:</strong> ${escapeHtml(originalSubject)}</div>
          <div>${safeOriginalPreview}</div>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#94a3b8;">Need anything else? Reply directly to this email and the thread will continue with QuizSolver support.</p>`;
  return {
    subject: `Re: ${message.subject || 'QuizSolver support'}`.substring(0, 240),
    text: `QuizSolver support reply:\n\n${replyText}\n\n---\nOriginal subject: ${originalSubject}\nOriginal message:\n${originalPreview || '(No original message body captured.)'}`,
    html: baseEmail({
      title: 'Support reply',
      preheader: 'QuizSolver support has replied',
      body,
      footer: `You are receiving this because you contacted QuizSolver support. Reply to this email to continue the conversation.`
    })
  };
}

async function sendViaResend({ to, subject, html, text, replyTo }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      reply_to: replyTo || SUPPORT_EMAIL
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Resend error ${response.status}`);
  return { provider: 'resend', id: data.id };
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!isEmailConfigured()) {
    console.warn(`[Email] Disabled; would send "${subject}" to ${to}.`);
    return { success: false, disabled: true };
  }
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend({ to, subject, html, text, replyTo });
    return { success: true, ...result };
  }
  const transport = getSmtpTransport();
  if (!transport) return { success: false, disabled: true };
  const info = await transport.sendMail({
    from: FROM_EMAIL,
    to,
    subject,
    text,
    html,
    replyTo: replyTo || SUPPORT_EMAIL
  });
  return { success: true, provider: 'smtp', id: info.messageId };
}


function deletionTemplate(code) {
  return {
    subject: 'QuizSolver Account Deletion Code',
    text: `Your QuizSolver account deletion code is ${code}. It expires in 15 minutes.`,
    html: baseEmail({
      title: 'Account Deletion Code',
      preheader: 'Verification code to delete your QuizSolver account.',
      body: `<p>You requested to delete your QuizSolver account.</p><p>Please use the following 6-digit code to confirm your request:</p><div style="text-align:center;padding:24px;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.1);border-radius:12px;font-size:32px;font-weight:900;letter-spacing:.2em;color:#06b6d4;margin:20px 0;">${code}</div><p style="color:#94a3b8;font-size:14px;">If you didn't request this, you can ignore this email. Your account will not be deleted.</p>`
    })
  };
}

function emailChangeTemplate(code) {
  return {
    subject: 'QuizSolver Email Change Code',
    text: `Your QuizSolver email change code is ${code}. It expires in 15 minutes.`,
    html: baseEmail({
      title: 'Email Change Code',
      preheader: 'Verification code to change your QuizSolver email address.',
      body: `<p>You requested to change your email address.</p><p>Please use the following 6-digit code to confirm this change:</p><div style="text-align:center;padding:24px;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.1);border-radius:12px;font-size:32px;font-weight:900;letter-spacing:.2em;color:#06b6d4;margin:20px 0;">${code}</div><p style="color:#94a3b8;font-size:14px;">If you didn't request this, you can safely ignore this email.</p>`
    })
  };
}


async function sendMarketingBatch(users, subject, htmlContent, discountOptions = {}) {
  if (!isEmailConfigured()) return { success: false, disabled: true };

  const emails = users.map((user, index) => {
    const token = Buffer.from(user._id.toString() + 'unsub').toString('base64');
    const unsubLink = `${SITE_URL}/api/auth/unsubscribe?id=${user._id}&token=${token}`;
    
    let personalizedHtml = htmlContent;
    
    // Inject tags
    personalizedHtml = personalizedHtml.replace(/\{\{EMAIL\}\}/g, user.email);
    if (discountOptions.discountPercent) {
      personalizedHtml = personalizedHtml.replace(/\{\{DISCOUNT_PERCENT\}\}/g, discountOptions.discountPercent);
    }
    if (discountOptions.discountExpiresDays) {
      personalizedHtml = personalizedHtml.replace(/\{\{DISCOUNT_EXPIRES\}\}/g, discountOptions.discountExpiresDays);
    }
    
    // Inject discount code if requested
    if (discountOptions.discountType === 'global' && discountOptions.globalCode) {
      personalizedHtml = personalizedHtml.replace(/\{\{DISCOUNT_CODE\}\}/g, discountOptions.globalCode);
    } else if (discountOptions.discountType === 'unique' && discountOptions.uniqueCodes) {
      personalizedHtml = personalizedHtml.replace(/\{\{DISCOUNT_CODE\}\}/g, discountOptions.uniqueCodes[index]);
    }

    personalizedHtml += `<br><br><hr style="border:none;border-top:1px solid #eee;"><p style="font-size:12px;color:#999;text-align:center;">You received this because you are opted into marketing emails. <a href="${unsubLink}">Click here to unsubscribe</a>.</p>`;

    return {
      from: FROM_EMAIL,
      to: [user.email],
      subject,
      html: baseEmail({
        title: subject,
        hideTitle: true,
        preheader: 'Marketing update from QuizSolver',
        body: personalizedHtml
      }),
      reply_to: SUPPORT_EMAIL
    };
  });

  if (process.env.RESEND_API_KEY) {
    const chunks = [];
    for (let i = 0; i < emails.length; i += 100) {
      chunks.push(emails.slice(i, i + 100));
    }
    
    for (const chunk of chunks) {
      try {
        const res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(chunk)
        });
        if (!res.ok) {
          const errData = await res.text();
          console.error('Resend batch API error:', res.status, errData);
        }
      } catch(err) {
        console.error('Resend batch network error:', err);
      }
    }
    return { success: true, count: emails.length };
  } else {
    const transport = getSmtpTransport();
    if (!transport) return { success: false, disabled: true };
    
    for (const email of emails) {
      await transport.sendMail(email).catch(err => console.error('SMTP error:', err));
    }
    return { success: true, count: emails.length };
  }
}

module.exports = {
  sendMarketingBatch,
  SITE_URL,
  SUPPORT_EMAIL,
  escapeHtml,
  isEmailConfigured,
  sendEmail,
  verificationTemplate,
  resetPasswordTemplate,
  deletionTemplate,
  emailChangeTemplate,
  supportReplyTemplate,
  baseEmail,
  welcomeTemplate,
  lowCreditsTemplate
};
