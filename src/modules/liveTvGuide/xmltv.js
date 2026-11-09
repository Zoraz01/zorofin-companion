'use strict';

// Minimal XMLTV rewriting. XMLTV is flat and regular, so programmes are edited
// as text blocks; anything not understood is passed through unchanged.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

function encode(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function element(block, name) {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? { whole: match[0], text: decode(match[1]).trim() } : null;
}

function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decode(match[1]) : '';
}

// Calls edit(programme) for each <programme>. edit returns { title, icon } to
// change; returning nothing leaves the block as it was.
async function rewriteProgrammes(xml, edit) {
  const pattern = /<programme\b[^>]*>[\s\S]*?<\/programme>/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(xml))) {
    parts.push(xml.slice(last, match.index));
    let block = match[0];
    try {
      const open = /^<programme\b[^>]*>/.exec(block)[0];
      const title = element(block, 'title');
      const iconTag = /<icon\b[^>]*\/?>/.exec(block);
      const programme = {
        channel: attribute(open, 'channel'),
        start: attribute(open, 'start'),
        title: title ? title.text : '',
        subTitle: (element(block, 'sub-title') || {}).text || '',
        desc: (element(block, 'desc') || {}).text || '',
        icon: iconTag ? attribute(iconTag[0], 'src') : '',
      };
      const change = programme.title ? await edit(programme) : null;
      if (change && change.title && title) {
        const lang = /\blang="[^"]*"/.exec(title.whole);
        block = block.replace(title.whole, `<title${lang ? ` ${lang[0]}` : ''}>${encode(change.title)}</title>`);
      }
      if (change && change.icon && !iconTag) {
        block = block.replace(/<\/programme>$/, `  <icon src="${encode(change.icon)}" />\n  </programme>`);
      }
    } catch (_) {
      block = match[0]; // fail open: one odd programme never breaks the guide
    }
    parts.push(block);
    last = match.index + match[0].length;
  }
  parts.push(xml.slice(last));
  return parts.join('');
}

module.exports = { decode, encode, rewriteProgrammes };

// Calls edit(channel) for each <channel>. edit returns { icon } to add one.
async function rewriteChannels(xml, edit) {
  const pattern = /<channel\b[^>]*>[\s\S]*?<\/channel>/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(xml))) {
    parts.push(xml.slice(last, match.index));
    let block = match[0];
    try {
      const open = /^<channel\b[^>]*>/.exec(block)[0];
      const iconTag = /<icon\b[^>]*\/?>/.exec(block);
      const name = element(block, 'display-name');
      const change = name ? await edit({ id: attribute(open, 'id'), name: name.text, hasIcon: Boolean(iconTag) }) : null;
      if (change && change.icon && iconTag && change.replace) {
        block = block.replace(iconTag[0], `<icon src="${encode(change.icon)}" />`);
      } else if (change && change.icon && !iconTag) {
        block = block.replace(/<\/channel>$/, `  <icon src="${encode(change.icon)}" />\n  </channel>`);
      }
    } catch (_) {
      block = match[0];
    }
    parts.push(block);
    last = match.index + match[0].length;
  }
  parts.push(xml.slice(last));
  return parts.join('');
}

module.exports.rewriteChannels = rewriteChannels;
