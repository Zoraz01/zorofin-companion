'use strict';

// Email templates. Layout ported from request-notifier; the operator's server
// name replaces the hard-coded wording.

const { cleanText, escapeHtml, safeHttpUrl } = require('../../lib/text');

const FONT = 'font-family:Arial,Helvetica,sans-serif';

function brandMark(logoSrc) {
  const safe = String(logoSrc || '').startsWith('cid:') ? String(logoSrc) : '';
  return safe ? `
                    <td style="width:52px;height:52px;vertical-align:middle">
                      <img src="${escapeHtml(safe)}" width="52" height="52" alt="Zorofin" style="display:block;width:52px;height:52px;border:0;object-fit:contain">
                    </td>` : `
                    <td bgcolor="#16a34a" style="width:42px;height:42px;border-radius:10px;color:#ffffff;${FONT};font-size:20px;font-weight:800;text-align:center;line-height:42px">Z</td>`;
}

function layout({ title, preheader, label, heading, bodyHtml, url, note, footer, logoSrc }) {
  const watchUrl = safeHttpUrl(url);
  const escapedUrl = escapeHtml(watchUrl);
  const button = watchUrl ? `
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:30px 0 8px">
                        <tr>
                          <td bgcolor="#42d779" style="border-radius:10px">
                            <a href="${escapedUrl}" style="display:inline-block;padding:15px 24px;color:#041208;${FONT};font-size:16px;font-weight:700;line-height:20px;text-decoration:none;border-radius:10px">Open Zorofin&nbsp;&nbsp;&rarr;</a>
                          </td>
                        </tr>
                      </table>` : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <meta name="supported-color-schemes" content="dark light">
    <title>${escapeHtml(title)}</title>
    <style>
      @media only screen and (max-width:620px) {
        .email-shell { width:100% !important; }
        .email-card { padding:30px 24px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#0d0e12">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#0d0e12">
      <tr>
        <td align="center" style="padding:34px 14px">
          <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px">
            <tr>
              <td style="padding:0 4px 20px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>${brandMark(logoSrc)}
                    <td style="padding-left:13px;color:#f3f4f6;${FONT};font-size:16px;font-weight:800;letter-spacing:2px;vertical-align:middle">ZOROFIN</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-card" bgcolor="#171d19" style="padding:42px 44px;border:1px solid #303a33;border-top:4px solid #42d779;border-radius:16px">
                <p style="display:inline-block;margin:0 0 18px;padding:6px 10px;border-radius:999px;background:#203328;color:#8ce8ae;${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px">${escapeHtml(label)}</p>
                <h1 style="margin:0;color:#ffffff;${FONT};font-size:32px;line-height:39px;font-weight:800;letter-spacing:-0.6px">${escapeHtml(heading)}</h1>
                <p style="margin:17px 0 0;color:#c9ccd6;${FONT};font-size:17px;line-height:27px">${bodyHtml}</p>${button}
                <p style="margin:24px 0 0;padding-top:22px;border-top:1px solid #30333d;color:#9499a8;${FONT};font-size:13px;line-height:21px">${escapeHtml(note)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0;color:#858a98;${FONT};font-size:12px;line-height:19px;text-align:center">${escapeHtml(footer)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderAvailabilityEmail({ title, mediaType, serverName, appUrl, logoSrc = '' }) {
  const safeTitle = cleanText(title, 180) || 'Your request';
  const server = cleanText(serverName, 80) || 'your server';
  const subject = `Ready to watch: ${safeTitle}`;
  const note = 'You get this because your account requested the title. Playback was confirmed before this message was sent.';
  const footer = 'Zorofin request alerts · Turn these off in Zorofin under Settings → Notifications.';
  const html = layout({
    title: subject,
    preheader: `${safeTitle} is now available on ${server}.`,
    label: mediaType === 'movie' ? 'MOVIE REQUEST' : 'SERIES REQUEST',
    heading: 'Ready to watch',
    bodyHtml: `<strong style="color:#ffffff">${escapeHtml(safeTitle)}</strong> is now available on ${escapeHtml(server)}.`,
    url: appUrl,
    note,
    footer,
    logoSrc,
  });
  const url = safeHttpUrl(appUrl);
  const text = ['ZOROFIN', '', 'READY TO WATCH', `${safeTitle} is now available on ${server}.`,
    ...(url ? ['', `Open Zorofin: ${url}`] : []), '', note, '', footer].join('\n');
  return { subject, html, text };
}

function renderConfirmationEmail({ code, serverName, logoSrc = '' }) {
  const server = cleanText(serverName, 80) || 'your server';
  const safeCode = String(code).replace(/[^0-9]/g, '').slice(0, 8);
  const subject = `Your Zorofin code: ${safeCode}`;
  const note = 'If you did not ask for request alerts, ignore this email. Nothing will be sent to this address.';
  const footer = 'Zorofin request alerts';
  const html = layout({
    title: subject,
    preheader: `Enter ${safeCode} in Zorofin to get request alerts by email.`,
    label: 'CONFIRM EMAIL',
    heading: safeCode,
    bodyHtml: `Enter this code in Zorofin to get alerts from ${escapeHtml(server)} when your requests are ready. It expires in 30 minutes.`,
    url: '',
    note,
    footer,
    logoSrc,
  });
  const text = ['ZOROFIN', '', `Your code: ${safeCode}`,
    `Enter this code in Zorofin to get alerts from ${server} when your requests are ready. It expires in 30 minutes.`,
    '', note].join('\n');
  return { subject, html, text };
}

module.exports = { renderAvailabilityEmail, renderConfirmationEmail };
