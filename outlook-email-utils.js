(function outlookEmailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.OutlookEmailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOutlookEmailUtils() {
  const OUTLOOK_EMAIL_PROVIDER = 'outlookemail-api';
  const DEFAULT_OUTLOOK_EMAIL_BASE_URL = '';
  const NON_ALLOCATABLE_ACCOUNT_STATUSES = new Set(['deleted', 'disabled', 'error', 'failed', 'removed']);
  const BASE_URL_SUFFIXES = [
    '/api/accounts/batch-update-group',
    '/api/external/accounts',
    '/api/external/emails',
    '/api/accounts',
    '/api/groups',
    '/api/csrf-token',
    '/login',
  ];

  function firstNonEmptyString(values) {
    for (const value of Array.isArray(values) ? values : []) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizePositiveIntegerString(value) {
    const numeric = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : '';
  }

  function normalizeOutlookEmailBaseUrl(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return DEFAULT_OUTLOOK_EMAIL_BASE_URL;

    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return DEFAULT_OUTLOOK_EMAIL_BASE_URL;
      }

      let pathname = parsed.pathname.replace(/\/+$/, '');
      const lowerPathname = pathname.toLowerCase();
      for (const suffix of BASE_URL_SUFFIXES) {
        if (lowerPathname === suffix || lowerPathname.endsWith(suffix)) {
          pathname = pathname.slice(0, pathname.length - suffix.length) || '/';
          break;
        }
      }

      parsed.pathname = pathname || '/';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return DEFAULT_OUTLOOK_EMAIL_BASE_URL;
    }
  }

  function normalizeOutlookEmailGroupId(value = '') {
    return normalizePositiveIntegerString(value);
  }

  function normalizeOutlookEmailGroup(group = {}) {
    const id = normalizeOutlookEmailGroupId(group.id ?? group.group_id ?? group.groupId);
    if (!id) return null;

    const accountCount = Number(group.account_count ?? group.accountCount ?? 0);
    return {
      id,
      name: firstNonEmptyString([group.name, `分组 ${id}`]),
      color: firstNonEmptyString([group.color, '#666666']),
      accountCount: Number.isFinite(accountCount) ? Math.max(0, Math.floor(accountCount)) : 0,
      description: firstNonEmptyString([group.description]),
      isSystem: Boolean(group.is_system ?? group.isSystem),
      sortPosition: Number.isFinite(Number(group.sort_position ?? group.sortPosition))
        ? Number(group.sort_position ?? group.sortPosition)
        : null,
    };
  }

  function normalizeOutlookEmailGroups(groups) {
    const seenIds = new Set();
    const normalized = [];

    for (const item of Array.isArray(groups) ? groups : []) {
      const group = normalizeOutlookEmailGroup(item);
      if (!group || seenIds.has(group.id)) continue;
      seenIds.add(group.id);
      normalized.push(group);
    }

    return normalized;
  }

  function normalizeOutlookEmailAccount(account = {}) {
    const id = normalizePositiveIntegerString(account.id ?? account.account_id ?? account.accountId);
    const email = firstNonEmptyString([account.email, account.address]).toLowerCase();
    if (!id || !email) return null;

    const aliases = [...new Set((Array.isArray(account.aliases) ? account.aliases : [])
      .map((alias) => String(alias || '').trim().toLowerCase())
      .filter(Boolean))];
    const aliasCountValue = Number(account.alias_count ?? account.aliasCount ?? aliases.length);

    return {
      id,
      email,
      groupId: normalizeOutlookEmailGroupId(account.group_id ?? account.groupId),
      groupName: firstNonEmptyString([account.group_name, account.groupName]),
      status: String(account.status || 'active').trim().toLowerCase() || 'active',
      provider: String(account.provider || 'outlook').trim().toLowerCase() || 'outlook',
      accountType: String(account.account_type || account.accountType || 'outlook').trim().toLowerCase() || 'outlook',
      aliases,
      aliasCount: Number.isFinite(aliasCountValue) ? Math.max(0, Math.floor(aliasCountValue)) : aliases.length,
      remark: firstNonEmptyString([account.remark]),
      forwardEnabled: Boolean(account.forward_enabled ?? account.forwardEnabled),
      lastRefreshAt: firstNonEmptyString([account.last_refresh_at, account.lastRefreshAt]),
      lastRefreshStatus: firstNonEmptyString([account.last_refresh_status, account.lastRefreshStatus]),
      lastRefreshError: firstNonEmptyString([account.last_refresh_error, account.lastRefreshError]),
      createdAt: firstNonEmptyString([account.created_at, account.createdAt]),
      updatedAt: firstNonEmptyString([account.updated_at, account.updatedAt]),
    };
  }

  function normalizeOutlookEmailAccounts(accounts) {
    const seenIds = new Set();
    const normalized = [];

    for (const item of Array.isArray(accounts) ? accounts : []) {
      const account = normalizeOutlookEmailAccount(item);
      if (!account || seenIds.has(account.id)) continue;
      seenIds.add(account.id);
      normalized.push(account);
    }

    return normalized;
  }

  function isOutlookEmailAccountAllocatable(account) {
    if (!account?.id || !account?.email) {
      return false;
    }

    return !NON_ALLOCATABLE_ACCOUNT_STATUSES.has(String(account.status || '').trim().toLowerCase());
  }

  function upsertOutlookEmailAccountInList(accounts, nextAccount) {
    const list = normalizeOutlookEmailAccounts(accounts).slice();
    const normalizedNext = normalizeOutlookEmailAccount(nextAccount);
    if (!normalizedNext?.id) return list;

    const existingIndex = list.findIndex((account) => account.id === normalizedNext.id);
    if (existingIndex === -1) {
      list.push(normalizedNext);
      return list;
    }

    list[existingIndex] = normalizedNext;
    return list;
  }

  function pickOutlookEmailAccountForRun(accounts, options = {}) {
    const candidates = normalizeOutlookEmailAccounts(accounts).filter(isOutlookEmailAccountAllocatable);
    if (!candidates.length) return null;

    const preferredIds = [
      normalizePositiveIntegerString(options.preferredAccountId),
      normalizePositiveIntegerString(options.currentAccountId),
    ].filter(Boolean);

    for (const preferredId of preferredIds) {
      const matched = candidates.find((account) => account.id === preferredId);
      if (matched) {
        return matched;
      }
    }

    const excludeIds = new Set((Array.isArray(options.excludeIds) ? options.excludeIds : [])
      .map((value) => normalizePositiveIntegerString(value))
      .filter(Boolean));
    const available = candidates.filter((account) => !excludeIds.has(account.id));
    const pool = available.length ? available : candidates;

    return pool
      .slice()
      .sort((left, right) => {
        const leftStatus = String(left.status || '').trim().toLowerCase();
        const rightStatus = String(right.status || '').trim().toLowerCase();
        const leftPriority = leftStatus === 'active' ? 0 : 1;
        const rightPriority = rightStatus === 'active' ? 0 : 1;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        const leftGroup = Number(left.groupId || 0);
        const rightGroup = Number(right.groupId || 0);
        if (leftGroup !== rightGroup) {
          return leftGroup - rightGroup;
        }

        return String(left.email || '').localeCompare(String(right.email || ''), 'en', {
          sensitivity: 'base',
        });
      })[0] || null;
  }

  return {
    DEFAULT_OUTLOOK_EMAIL_BASE_URL,
    OUTLOOK_EMAIL_PROVIDER,
    isOutlookEmailAccountAllocatable,
    normalizeOutlookEmailAccount,
    normalizeOutlookEmailAccounts,
    normalizeOutlookEmailBaseUrl,
    normalizeOutlookEmailGroup,
    normalizeOutlookEmailGroupId,
    normalizeOutlookEmailGroups,
    pickOutlookEmailAccountForRun,
    upsertOutlookEmailAccountInList,
  };
});
