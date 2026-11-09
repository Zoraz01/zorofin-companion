'use strict';

// M3U playlists: read an operator's playlist line by line, write the slim one.

const ATTRIBUTE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

function attributes(text) {
  const out = {};
  for (const [, key, value] of text.matchAll(ATTRIBUTE)) out[key.toLowerCase()] = value;
  return out;
}

// Reads #EXTINF entries from an async iterable of lines. Calls keep(entry)
// for each and collects the ones it accepts, so a huge playlist never sits in
// memory. Yields { name, id, logo, group, url }.
async function readPlaylist(lineSource, keep) {
  const kept = [];
  let pending = null;
  let seen = 0;
  for await (const raw of lineSource) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      const head = comma >= 0 ? line.slice(0, comma) : line;
      const attrs = attributes(head);
      pending = {
        name: (comma >= 0 ? line.slice(comma + 1) : '').trim() || attrs['tvg-name'] || '',
        id: attrs['tvg-id'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
      };
    } else if (line.startsWith('#EXTGRP:') && pending && !pending.group) {
      pending.group = line.slice(8).trim();
    } else if (!line.startsWith('#') && pending) {
      pending.url = line;
      seen += 1;
      if (keep(pending)) kept.push(pending);
      pending = null;
    }
  }
  return { kept, seen };
}

const quote = value => String(value || '').replace(/["\r\n]/g, ' ');

function renderPlaylist(channels) {
  const out = ['#EXTM3U'];
  for (const channel of channels) {
    out.push(`#EXTINF:-1 tvg-id="${quote(channel.guideId)}" tvg-name="${quote(channel.name)}" tvg-logo="${quote(channel.logo)}" group-title="${quote(channel.group)}",${String(channel.name).replace(/[\r\n]/g, ' ')}`);
    out.push(channel.url);
  }
  return `${out.join('\n')}\n`;
}

module.exports = { attributes, readPlaylist, renderPlaylist };
