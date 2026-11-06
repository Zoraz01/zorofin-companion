'use strict';

// Input cleaning shared by modules. Ported from request-notifier.

function cleanText(value, maxLength) {
  if (value == null) return '';
  return String(value)
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeTitle(value) {
  return cleanText(value, 240).toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeIdentifier(value, maxLength = 80) {
  const cleaned = cleanText(value, maxLength);
  return /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : '';
}

// Jellyfin ids arrive with or without dashes; the bridge uses 32 lowercase hex.
function jellyfinId(value) {
  const cleaned = cleanText(value, 40).replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(cleaned) ? cleaned : '';
}

function normalizeEmail(value) {
  const email = cleanText(value, 254).toLocaleLowerCase('en-US');
  if (!email || email.includes(' ') || email.includes('..')) return '';
  const at = email.lastIndexOf('@');
  if (at < 1 || at > 64 || at !== email.indexOf('@')) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return '';
  if (domain.length > 253 || !domain.includes('.') || !/^[a-z0-9.-]+$/i.test(domain)) return '';
  if (domain.split('.').some(label => !label || label.length > 63 ||
      label.startsWith('-') || label.endsWith('-'))) return '';
  return email;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : '';
  } catch (_) { return ''; }
}

module.exports = { cleanText, escapeHtml, jellyfinId, normalizeEmail, normalizeTitle, safeHttpUrl, safeIdentifier };
