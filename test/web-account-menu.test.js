'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { actions } = require('../web-ui/36-theme-account-menu.js');

const run = () => {};
const keys = (list) => list.map((item) => item.key);

test('account menu follows the TV order with Settings last', () => {
  const list = actions({
    syncPlay: true,
    teams: true,
    extra: [
      { key: 'page-calendar', label: 'Calendar', run },
      { key: 'page-catchup', label: 'Catch Up', run },
      { key: 'pick-together', label: 'Pick Together', run },
      { key: 'home-previews', label: 'Home trailer previews · On', run },
    ],
  });
  assert.deepEqual(keys(list), [
    'switch', 'pick-together', 'together', 'page-calendar', 'page-catchup', 'teams', 'home-previews', 'settings',
  ]);
  assert.equal(list[0].label, 'Switch profile');
  assert.equal(list.at(-1).pinned, true);
});

test('account menu drops Change server and Quick Connect', () => {
  assert.deepEqual(keys(actions()), ['switch', 'settings']);
  assert.deepEqual(keys(actions({ extra: [{ key: 'bad', label: 'No action' }] })), ['switch', 'settings']);
});
