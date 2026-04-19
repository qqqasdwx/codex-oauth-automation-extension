const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../outlook-email-utils.js');

test('normalizeOutlookEmailBaseUrl strips known API suffixes and preserves origin', () => {
  assert.equal(
    utils.normalizeOutlookEmailBaseUrl('http://127.0.0.1:5000/api/accounts/batch-update-group'),
    'http://127.0.0.1:5000'
  );
  assert.equal(
    utils.normalizeOutlookEmailBaseUrl('https://mail.example.com/login'),
    'https://mail.example.com'
  );
});

test('normalizeOutlookEmailGroups deduplicates ids and normalizes display fields', () => {
  const groups = utils.normalizeOutlookEmailGroups([
    { id: 1, name: '注册池', color: '#111111', account_count: 3 },
    { id: '1', name: '重复项' },
    { id: 2, account_count: '5' },
  ]);

  assert.deepStrictEqual(groups, [
    {
      id: '1',
      name: '注册池',
      color: '#111111',
      accountCount: 3,
      description: '',
      isSystem: false,
      sortPosition: null,
    },
    {
      id: '2',
      name: '分组 2',
      color: '#666666',
      accountCount: 5,
      description: '',
      isSystem: false,
      sortPosition: null,
    },
  ]);
});

test('pickOutlookEmailAccountForRun prefers active allocatable accounts and skips excluded ids', () => {
  const picked = utils.pickOutlookEmailAccountForRun([
    { id: 2, email: 'used@example.com', status: 'active', group_id: 9 },
    { id: 1, email: 'ready@example.com', status: 'active', group_id: 8 },
    { id: 3, email: 'disabled@example.com', status: 'disabled', group_id: 1 },
  ], {
    excludeIds: ['2'],
  });

  assert.deepStrictEqual(picked, {
    id: '1',
    email: 'ready@example.com',
    groupId: '8',
    groupName: '',
    status: 'active',
    provider: 'outlook',
    accountType: 'outlook',
    aliases: [],
    aliasCount: 0,
    remark: '',
    forwardEnabled: false,
    lastRefreshAt: '',
    lastRefreshStatus: '',
    lastRefreshError: '',
    createdAt: '',
    updatedAt: '',
  });
});
