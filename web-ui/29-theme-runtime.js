/* Zorofin web look: runtime for the companion pack. Built by tools/build-companion-web-ui.cjs. */
(function () {
  'use strict';
  var current = document.currentScript;
  var base = current && current.src ? new URL('./', current.src).href : new URL('../Zorofin/Web/ui/', document.baseURI).href;
  window.ZorofinWeb = window.ZorofinWeb || { base: base };
  if (window.ZorofinUI) return;
  document.documentElement.classList.add('zoro-ui');
  var ready = Promise.resolve();
  window.ZorofinUI = { version: 'companion', active: true, start: function () { return ready; }, load: function () { return ready; } };
}());
