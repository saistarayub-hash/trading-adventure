'use strict';
/* brand/nlh.js — Northern Lights Herb edition switch, age gate and DOC skin.
 *
 * Switched ON with  ?brand=nlh   (remembered in localStorage afterwards)
 * Switched OFF with ?brand=off  (also forgotten)
 * With the flag off this file returns immediately and changes nothing, so the
 * finalized v1.1.0 product is bit-for-bit the same experience.
 *
 * Runs at parse time (it is loaded before companion.js) so the 18+ gate is on
 * screen before any coach content paints.
 */
(function () {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') return; // test harness stubs

  var KEY = 'nlhBrand';
  var AGE = 'nlhAgeOk';
  var q = new URLSearchParams(location.search);
  try {
    if (q.get('brand') === 'nlh') localStorage.setItem(KEY, 'nlh');
    if (q.get('brand') === 'off') { localStorage.removeItem(KEY); localStorage.removeItem(AGE); }
  } catch (e) {}
  var active = false;
  try { active = localStorage.getItem(KEY) === 'nlh'; } catch (e) {}
  if (!active) return;

  var ORG = 'Northern Lights Herb';
  var DOC = 'DOC';
  document.body.setAttribute('data-brand', 'nlh');
  document.title = DOC + ' — Trading Companion · ' + ORG;
  window.NLH = { active: true, name: DOC, org: ORG };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ── compliance footer, every screen ── */
  document.body.appendChild(el('div', 'nlh-footer',
    '<b>18+</b> · Private-use education &amp; entertainment only · <b>' + ORG +
    '</b> does not sell cannabis through this app · Nothing here is financial or medical advice.'));

  /* ── splash ── */
  var splash = el('div', 'nlh-splash',
    '<div style="text-align:center"><img src="brand/art/doc.png" alt="DOC">' +
    '<div class="who">' + ORG + ' presents <b style="color:#a3e635">' + DOC + '</b></div></div>');

  /* ── the 18+ door ── */
  var ageOk = false;
  try { ageOk = localStorage.getItem(AGE) === '1'; } catch (e) {}

  function enter() {
    document.body.appendChild(splash);
    setTimeout(function () { splash.classList.add('fade'); }, 850);
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 1400);
  }

  if (ageOk) {
    enter();
  } else {
    var gate = el('div', 'nlh-gate');
    gate.appendChild(el('div', 'gate-card',
      '<img src="brand/art/doc.png" alt="DOC">' +
      '<div class="org">' + ORG + '</div>' +
      '<h1>Hey, I’m <b>' + DOC + '</b>.</h1>' +
      '<p>This joint teaches trading — charts, risk, discipline — with a cannabis-culture flavour. ' +
      'It’s for adults only. Are you 18 or older?</p>' +
      '<div class="row"><button class="yes" id="nlhYes">Yes, I’m 18+</button>' +
      '<button id="nlhNo">No, not yet</button></div>' +
      '<div class="fine">By continuing you confirm you are of legal age in your country. ' +
      'We do not sell cannabis here, and nothing in this app is financial or medical advice.</div>'));
    document.body.appendChild(gate);
    gate.querySelector('#nlhYes').addEventListener('click', function () {
      try { localStorage.setItem(AGE, '1'); } catch (e) {}
      gate.parentNode.removeChild(gate);
      enter();
    });
    gate.querySelector('#nlhNo').addEventListener('click', function () {
      gate.querySelector('.gate-card').innerHTML =
        '<img src="brand/art/doc.png" alt="DOC">' +
        '<h1>Come back later 🌱</h1>' +
        '<p>' + DOC + ' only teaches grown-ups. Until you’re 18, the Professor Fox lessons ' +
        'on this server are the right place for you.</p>' +
        '<div class="fine">' + ORG + ' · 18+ only</div>';
    });
  }

  /* ── DOC takes the fox’s seat ── */
  function skinDoc() {
    var av = document.getElementById('btnAvatar');
    if (av && !av.querySelector('img.doc-face')) {
      av.innerHTML = '<img class="doc-face" src="brand/art/doc.png" alt="DOC">';
      av.title = DOC + ' — your coach';
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', skinDoc);
  } else {
    skinDoc();
  }
})();
