'use strict';
/* engine/index.js — one place to require the whole companion brain.
 *
 * Node-only facade (it pulls in fs/http/zlib modules). The pure reasoning
 * modules (vision, curriculum, distill, coach, embed, chunk, bm25) also load
 * directly in the browser/Electron renderer via <script> tags. */

const net = require('./net');
const text = require('./text');
const youtube = require('./youtube');
const ingest = require('./ingest');
const chunk = require('./chunk');
const embed = require('./embed');
const bm25 = require('./bm25');
const { KnowledgeBase, uid } = require('./kb');
const vision = require('./vision');
const curriculum = require('./curriculum');
const distill = require('./distill');
const coach = require('./coach');

const VERSION = '1.0.0';

/** Convenience: ingest a link/text/file straight into a knowledge base. */
async function feed(kb, input) {
  let r;
  if (input.url) r = await ingest.ingestUrl(input.url, input);
  else if (input.file) r = ingest.ingestFile(input.file);
  else r = ingest.ingestText(input.text || '', input.title);
  if (!r.ok) return r;
  const added = kb.addSource({
    kind: r.kind,
    url: r.url || '',
    title: r.title || (input && input.title) || '',
    text: r.text,
    note: r.note || '',
    meta: r.meta || {},
    tags: (r.tags || []).concat((input && input.tags) || [])
  });
  if (!added.ok) return added;
  return Object.assign({ ok: true, ingested: r }, added);
}

module.exports = {
  VERSION, net, text, youtube, ingest, chunk, embed, bm25, vision, curriculum, distill, coach,
  KnowledgeBase, Coach: coach.Coach, uid, feed
};
