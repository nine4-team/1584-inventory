import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function unwrapToolText(raw) {
  const t = raw.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      // ignore
    }
  }
  return raw;
}

function extractJsonArrayFromMcpToolTextFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const text = unwrapToolText(raw);
  const m = text.match(
    /<untrusted-data-[^>]+>\s*(\[[\s\S]*\])\s*<\/untrusted-data-[^>]+>/
  );
  if (!m) {
    throw new Error(`Could not find <untrusted-data> JSON array in ${filePath}`);
  }
  return JSON.parse(m[1]);
}

function co(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function boolStr(v) {
  if (v === null || v === undefined) return 'false';
  return String(!!v);
}

function normalizeTax4(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return '';
  return n.toFixed(4);
}

function normalizeLocalTsToMs(v) {
  if (!v) return '';
  let s = String(v);
  // Trim microseconds -> milliseconds for JS Date parsing stability
  s = s.replace(/(\.\d{3})\d+(?=(Z|[+-]\d\d:\d\d)$)/, '$1');
  const t = Date.parse(s);
  if (Number.isNaN(t)) return '';
  return String(t);
}

function normalizeServerTsToMs(v) {
  if (!v) return '';
  let s = String(v).trim();
  // Common format returned by execute_sql: "2026-02-03 08:00:14.992+00"
  // Make it ISO-ish for Date.parse.
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) {
    s = s.replace(' ', 'T');
  }
  // "+00" -> "+00:00"
  s = s.replace(/([+-]\d{2})(?!:)/, '$1:00');
  // Trim microseconds -> milliseconds (if present)
  s = s.replace(/(\.\d{3})\d+(?=(Z|[+-]\d\d:\d\d)$)/, '$1');
  const t = Date.parse(s);
  if (Number.isNaN(t)) return '';
  return String(t);
}

function itemImagesHash(images) {
  const arr = Array.isArray(images) ? images : [];
  const parts = arr
    .map((e) => ({
      url: co(e?.url),
      fileName: co(e?.fileName),
      uploadedAt: co(e?.uploadedAt),
      mimeType: co(e?.mimeType),
      size: co(e?.size),
      isPrimary: co(e?.isPrimary),
      alt: co(e?.alt),
    }))
    .sort((a, b) =>
      (a.url + a.fileName + a.uploadedAt).localeCompare(b.url + b.fileName + b.uploadedAt)
    )
    .map((e) =>
      [e.url, e.fileName, e.uploadedAt, e.mimeType, e.size, e.isPrimary, e.alt].join('~')
    );
  return md5(parts.join('||'));
}

function txImagesHash(images) {
  const arr = Array.isArray(images) ? images : [];
  const parts = arr
    .map((e) => ({
      url: co(e?.url),
      fileName: co(e?.fileName),
      uploadedAt: co(e?.uploadedAt),
      mimeType: co(e?.mimeType),
      size: co(e?.size),
    }))
    .sort((a, b) =>
      (a.url + a.fileName + a.uploadedAt).localeCompare(b.url + b.fileName + b.uploadedAt)
    )
    .map((e) => [e.url, e.fileName, e.uploadedAt, e.mimeType, e.size].join('~'));
  return md5(parts.join('||'));
}

function idsHash(ids) {
  const arr = (Array.isArray(ids) ? ids : []).map(String).slice().sort();
  return md5(arr.join('||'));
}

function localItemScalarHash(it) {
  const parts = [
    co(it.accountId),
    co(it.projectId),
    co(it.transactionId),
    co(it.previousProjectTransactionId),
    co(it.previousProjectId),
    co(it.description),
    co(it.source),
    co(it.sku),
    co(it.purchasePrice),
    co(it.projectPrice),
    co(it.marketValue),
    co(it.paymentMethod),
    co(it.disposition),
    co(it.notes),
    co(it.space),
    co(it.qrKey),
    boolStr(it.bookmark),
    co(it.dateCreated),
    normalizeLocalTsToMs(it.lastUpdated),
    normalizeLocalTsToMs(it.createdAt),
    normalizeTax4(it.taxRatePct),
    co(it.inventoryStatus),
    co(it.originTransactionId),
    co(it.latestTransactionId),
    co(it.taxAmountPurchasePrice),
    co(it.taxAmountProjectPrice),
    co(it.version),
  ];
  return md5(parts.join('||'));
}

function localTxScalarHash(t) {
  const parts = [
    co(t.accountId),
    co(t.projectId),
    co(t.transactionDate),
    co(t.source),
    co(t.transactionType),
    co(t.amount),
    co(t.description),
    co(t.budgetCategory),
    co(t.status),
    co(t.paymentMethod),
    co(t.reimbursementType),
    co(t.triggerEvent),
    co(t.notes),
    boolStr(t.receiptEmailed),
    co(t.taxRatePreset),
    normalizeTax4(t.taxRatePct),
    co(t.subtotal),
    boolStr(t.needsReview),
    co(t.sumItemPurchasePrices),
    co(t.categoryId),
    co(t.purchaseMethod),
    co(t.version),
  ];
  return md5(parts.join('||'));
}

function formatMdTable(rows, columns) {
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => co(r[c.key]) || '*(empty)*').join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function summarizeFieldDiffs(diffs) {
  const counts = new Map();
  for (const d of diffs) {
    for (const f of d.fields || []) {
      counts.set(f, (counts.get(f) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
}

// --- Config (this run) ---
const accountId = '1dd4fd75-8eea-4f7a-98e7-bf45b987ae94';
const exportPath = path.resolve(
  'dev_docs/troubleshooting/local-server-reconciliation/ledger-offline-export-lisa-ipad-2026-02-04T02_27_09.873Z.json'
);

const serverItemsHashesToolTextPath =
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/cc6d62db-1862-449d-b495-f314d4773097.txt';
const serverTxHashesToolTextPath =
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/356f25c3-c3e0-43e9-8a43-c196c46187d0.txt';

const serverItemsServerOnlyChunkToolTextPaths = [
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/215f13fc-3455-48d0-be74-014f6b17995a.txt',
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/a3ba9d35-7f1d-44fa-8937-a00eee2703ee.txt',
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/f58eaaab-b4a7-4cdc-acd1-93814806e65b.txt',
];

const serverItemsMismatchChunkToolTextPaths = [
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/1c07e994-8aa1-424a-ab2e-b10561443976.txt',
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/8863e54c-1576-4e37-b1a3-734f9f6ff150.txt',
];

const serverTxServerOnlyToolTextPath =
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/a40734c9-72b5-4591-9cb7-caad0ecfb874.txt';
const serverTxMismatchChunkToolTextPaths = [
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/5aaa1220-e822-43f3-b4bc-f964cc244951.txt',
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/c8150f42-f959-4a65-b58b-fb507dd5a05b.txt',
];

const serverProjectsToolTextPath =
  '/Users/benjaminmackenzie/.cursor/projects/Users-benjaminmackenzie-Dev-ledger/agent-tools/13105990-3f9b-4600-b571-7c70bf20f42a.txt';

const outDir = path.resolve('dev_docs/troubleshooting/local-server-reconciliation');
const reportDate = '2026-02-04';
const reportStem = `reconciliation_offline_vs_server_report_${reportDate}_account-1dd4fd75_lisa-ipad`;
const outJsonPath = path.join(outDir, `${reportStem}.json`);
const outMdPath = path.join(outDir, `${reportStem}.md`);

// --- Load data ---
const exp = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
const localItems = exp.items || [];
const localTx = exp.transactions || [];
const localProjects = exp.projects || [];

const serverItemHashes = extractJsonArrayFromMcpToolTextFile(serverItemsHashesToolTextPath);
const serverTxHashes = extractJsonArrayFromMcpToolTextFile(serverTxHashesToolTextPath);

const serverOnlyItemRows = serverItemsServerOnlyChunkToolTextPaths.flatMap((p) =>
  extractJsonArrayFromMcpToolTextFile(p)
);
const mismatchItemRows = serverItemsMismatchChunkToolTextPaths.flatMap((p) =>
  extractJsonArrayFromMcpToolTextFile(p)
);

const serverOnlyTxRows = extractJsonArrayFromMcpToolTextFile(serverTxServerOnlyToolTextPath);
const mismatchTxRows = serverTxMismatchChunkToolTextPaths.flatMap((p) =>
  extractJsonArrayFromMcpToolTextFile(p)
);

const serverProjects = extractJsonArrayFromMcpToolTextFile(serverProjectsToolTextPath);

// Indexes
const serverItemHashById = new Map(serverItemHashes.map((r) => [r.item_id, r]));
const serverTxHashById = new Map(serverTxHashes.map((r) => [r.transaction_id, r]));

const serverOnlyItemById = new Map(serverOnlyItemRows.map((r) => [r.item_id, r]));
const mismatchItemById = new Map(mismatchItemRows.map((r) => [r.item_id, r]));

const serverOnlyTxById = new Map(serverOnlyTxRows.map((r) => [r.transaction_id, r]));
const mismatchTxById = new Map(mismatchTxRows.map((r) => [r.transaction_id, r]));

const serverProjectById = new Map(serverProjects.map((p) => [p.id, p]));

const localItemById = new Map(localItems.map((it) => [it.itemId, it]));
const localTxById = new Map(localTx.map((t) => [t.transactionId, t]));
const localProjectById = new Map(localProjects.map((p) => [p.id, p]));

// --- Reconcile items ---
const localItemIds = [...localItemById.keys()].sort();
const serverItemIds = [...serverItemHashById.keys()].sort();

const itemLocalOnlyIds = localItemIds.filter((id) => !serverItemHashById.has(id));
const itemServerOnlyIds = serverItemIds.filter((id) => !localItemById.has(id));

const itemScalarMismatchIds = [];
const itemImagesMismatchIds = [];
for (const id of localItemIds) {
  const s = serverItemHashById.get(id);
  if (!s) continue;
  const l = localItemById.get(id);
  const localScalar = localItemScalarHash(l);
  const localImages = itemImagesHash(l?.images);
  if (localScalar !== s.scalar_hash) itemScalarMismatchIds.push(id);
  if (localImages !== s.images_hash) itemImagesMismatchIds.push(id);
}

function diffItem(local, server) {
  const diffs = [];
  const pairs = [
    ['projectId', 'project_id', (v) => co(v)],
    ['transactionId', 'transaction_id', (v) => co(v)],
    ['previousProjectTransactionId', 'previous_project_transaction_id', (v) => co(v)],
    ['previousProjectId', 'previous_project_id', (v) => co(v)],
    ['description', 'description', (v) => co(v)],
    ['source', 'source', (v) => co(v)],
    ['sku', 'sku', (v) => co(v)],
    ['purchasePrice', 'purchase_price', (v) => co(v)],
    ['projectPrice', 'project_price', (v) => co(v)],
    ['marketValue', 'market_value', (v) => co(v)],
    ['paymentMethod', 'payment_method', (v) => co(v)],
    ['disposition', 'disposition', (v) => co(v)],
    ['notes', 'notes', (v) => co(v)],
    ['space', 'space', (v) => co(v)],
    ['qrKey', 'qr_key', (v) => co(v)],
    ['bookmark', 'bookmark', (v) => boolStr(v)],
    ['dateCreated', 'date_created', (v) => co(v)],
    ['lastUpdated', 'last_updated', (v, side) =>
      side === 'local' ? normalizeLocalTsToMs(v) : normalizeServerTsToMs(v)
    ],
    ['createdAt', 'created_at', (v, side) =>
      side === 'local' ? normalizeLocalTsToMs(v) : normalizeServerTsToMs(v)
    ],
    ['taxRatePct', 'tax_rate_pct', (v) => normalizeTax4(v)],
    ['inventoryStatus', 'inventory_status', (v) => co(v)],
    ['originTransactionId', 'origin_transaction_id', (v) => co(v)],
    ['latestTransactionId', 'latest_transaction_id', (v) => co(v)],
    ['taxAmountPurchasePrice', 'tax_amount_purchase_price', (v) => co(v)],
    ['taxAmountProjectPrice', 'tax_amount_project_price', (v) => co(v)],
    ['version', 'version', (v) => co(v)],
  ];

  for (const [lKey, sKey, norm] of pairs) {
    const lv = norm(local?.[lKey], 'local');
    const sv = norm(server?.[sKey], 'server');
    if (lv !== sv) diffs.push({ field: lKey, local: local?.[lKey] ?? null, server: server?.[sKey] ?? null });
  }

  // Images
  const localImgHash = itemImagesHash(local?.images);
  const serverImgHash = itemImagesHash(server?.images);
  if (localImgHash !== serverImgHash) {
    diffs.push({ field: 'images', local: `hash:${localImgHash}`, server: `hash:${serverImgHash}` });
  }

  return diffs;
}

const itemDiffs = [];
for (const id of new Set([...itemScalarMismatchIds, ...itemImagesMismatchIds])) {
  const local = localItemById.get(id);
  const server = mismatchItemById.get(id);
  if (!server) {
    // Fallback: sometimes a mismatch row may not be present if chunking changed; skip rather than crash.
    continue;
  }
  const diffs = diffItem(local, server);
  if (diffs.length > 0) {
    itemDiffs.push({
      itemId: id,
      fields: diffs.map((d) => d.field),
      diffs,
      localSummary: {
        description: local?.description ?? '',
        sku: local?.sku ?? '',
        projectId: local?.projectId ?? null,
        transactionId: local?.transactionId ?? null,
        lastUpdated: local?.lastUpdated ?? null,
        last_synced_at: local?.last_synced_at ?? null,
      },
      serverSummary: {
        project_id: server?.project_id ?? null,
        transaction_id: server?.transaction_id ?? null,
        last_updated: server?.last_updated ?? null,
      },
    });
  }
}

// --- Reconcile transactions ---
const localTxIds = [...localTxById.keys()].sort();
const serverTxIds = [...serverTxHashById.keys()].sort();

const txLocalOnlyIds = localTxIds.filter((id) => !serverTxHashById.has(id));
const txServerOnlyIds = serverTxIds.filter((id) => !localTxById.has(id));

const txScalarMismatchIds = [];
const txItemIdsMismatchIds = [];
const txImagesMismatchIds = [];
for (const id of localTxIds) {
  const s = serverTxHashById.get(id);
  if (!s) continue;
  const l = localTxById.get(id);
  const localScalar = localTxScalarHash(l);
  const localIds = idsHash(l?.itemIds);
  const localTi = txImagesHash(l?.transactionImages);
  const localRi = txImagesHash(l?.receiptImages);
  const localOi = txImagesHash(l?.otherImages);
  if (localScalar !== s.scalar_hash) txScalarMismatchIds.push(id);
  if (localIds !== s.item_ids_hash) txItemIdsMismatchIds.push(id);
  if (localTi !== s.transaction_images_hash || localRi !== s.receipt_images_hash || localOi !== s.other_images_hash)
    txImagesMismatchIds.push(id);
}

function diffTx(local, server) {
  const diffs = [];
  const pairs = [
    ['projectId', 'project_id', (v) => co(v)],
    ['transactionDate', 'transaction_date', (v) => co(v)],
    ['source', 'source', (v) => co(v)],
    ['transactionType', 'transaction_type', (v) => co(v)],
    ['amount', 'amount', (v) => co(v)],
    ['description', 'description', (v) => co(v)],
    ['budgetCategory', 'budget_category', (v) => co(v)],
    ['status', 'status', (v) => co(v)],
    ['paymentMethod', 'payment_method', (v) => co(v)],
    ['reimbursementType', 'reimbursement_type', (v) => co(v)],
    ['triggerEvent', 'trigger_event', (v) => co(v)],
    ['notes', 'notes', (v) => co(v)],
    ['receiptEmailed', 'receipt_emailed', (v) => boolStr(v)],
    ['taxRatePreset', 'tax_rate_preset', (v) => co(v)],
    ['taxRatePct', 'tax_rate_pct', (v) => normalizeTax4(v)],
    ['subtotal', 'subtotal', (v) => co(v)],
    ['needsReview', 'needs_review', (v) => boolStr(v)],
    ['sumItemPurchasePrices', 'sum_item_purchase_prices', (v) => co(v)],
    ['categoryId', 'category_id', (v) => co(v)],
    ['purchaseMethod', 'purchase_method', (v) => co(v)],
    ['version', 'version', (v) => co(v)],
  ];

  for (const [lKey, sKey, norm] of pairs) {
    const lv = norm(local?.[lKey], 'local');
    const sv = norm(server?.[sKey], 'server');
    if (lv !== sv) diffs.push({ field: lKey, local: local?.[lKey] ?? null, server: server?.[sKey] ?? null });
  }

  const localItemIdsSorted = (Array.isArray(local?.itemIds) ? local.itemIds : []).map(String).slice().sort();
  const serverItemIdsSorted = (Array.isArray(server?.item_ids) ? server.item_ids : []).map(String).slice().sort();
  if (localItemIdsSorted.join('||') !== serverItemIdsSorted.join('||')) {
    diffs.push({ field: 'itemIds', local: localItemIdsSorted, server: serverItemIdsSorted });
  }

  const localTi = txImagesHash(local?.transactionImages);
  const localRi = txImagesHash(local?.receiptImages);
  const localOi = txImagesHash(local?.otherImages);
  const serverTi = txImagesHash(server?.transaction_images);
  const serverRi = txImagesHash(server?.receipt_images);
  const serverOi = txImagesHash(server?.other_images);
  if (localTi !== serverTi) diffs.push({ field: 'transactionImages', local: `hash:${localTi}`, server: `hash:${serverTi}` });
  if (localRi !== serverRi) diffs.push({ field: 'receiptImages', local: `hash:${localRi}`, server: `hash:${serverRi}` });
  if (localOi !== serverOi) diffs.push({ field: 'otherImages', local: `hash:${localOi}`, server: `hash:${serverOi}` });

  return diffs;
}

const txDiffs = [];
for (const id of new Set([...txScalarMismatchIds, ...txItemIdsMismatchIds, ...txImagesMismatchIds])) {
  const local = localTxById.get(id);
  const server = mismatchTxById.get(id);
  if (!server) continue;
  const diffs = diffTx(local, server);
  if (diffs.length > 0) {
    txDiffs.push({
      transactionId: id,
      fields: diffs.map((d) => d.field),
      diffs,
      localSummary: {
        transactionDate: local?.transactionDate ?? '',
        source: local?.source ?? '',
        amount: local?.amount ?? '',
        status: local?.status ?? '',
      },
      serverSummary: {
        transaction_date: server?.transaction_date ?? '',
        source: server?.source ?? '',
        amount: server?.amount ?? '',
        status: server?.status ?? '',
      },
    });
  }
}

// --- Reconcile projects ---
const localProjectIds = [...localProjectById.keys()].sort();
const serverProjectIds = [...serverProjectById.keys()].sort();
const projectLocalOnlyIds = localProjectIds.filter((id) => !serverProjectById.has(id));
const projectServerOnlyIds = serverProjectIds.filter((id) => !localProjectById.has(id));

function diffProject(local, server) {
  const diffs = [];
  const pairs = [
    ['name', 'name', (v) => co(v)],
    ['description', 'description', (v) => co(v)],
    ['clientName', 'client_name', (v) => co(v)],
    ['budget', 'budget', (v) => co(v)],
    ['designFee', 'design_fee', (v) => co(v)],
    ['budgetCategories', 'budget_categories', (v) => JSON.stringify(v ?? {})],
    ['settings', 'settings', (v) => JSON.stringify(v ?? {})],
    ['metadata', 'metadata', (v) => JSON.stringify(v ?? {})],
    ['version', 'version', (v) => co(v)],
    ['createdAt', 'created_at', (v, side) =>
      side === 'local' ? normalizeLocalTsToMs(v) : normalizeServerTsToMs(v)
    ],
    ['updatedAt', 'updated_at', (v, side) =>
      side === 'local' ? normalizeLocalTsToMs(v) : normalizeServerTsToMs(v)
    ],
  ];
  for (const [lKey, sKey, norm] of pairs) {
    const lv = norm(local?.[lKey], 'local');
    const sv = norm(server?.[sKey], 'server');
    if (lv !== sv) diffs.push({ field: lKey, local: local?.[lKey] ?? null, server: server?.[sKey] ?? null });
  }
  return diffs;
}

const projectDiffs = [];
for (const id of localProjectIds) {
  const server = serverProjectById.get(id);
  if (!server) continue;
  const local = localProjectById.get(id);
  const diffs = diffProject(local, server);
  if (diffs.length > 0) projectDiffs.push({ projectId: id, fields: diffs.map((d) => d.field), diffs });
}

// --- Assemble output ---
const generatedAt = new Date().toISOString();

const reportJson = {
  generatedAt,
  export: {
    sourcePath: path.relative(process.cwd(), exportPath),
    exportedAt: exp.exportedAt,
    accountId,
    currentUserId: exp?.context?.currentUserId ?? null,
  },
  offlineSnapshot: {
    counts: exp.counts ?? {},
    items: localItems.length,
    transactions: localTx.length,
    projects: localProjects.length,
    operations: (exp.operations || []).length,
    conflicts: (exp.conflicts || []).length,
  },
  serverSnapshot: {
    items: serverItemIds.length,
    transactions: serverTxIds.length,
    projects: serverProjectIds.length,
    sourceToolTextPaths: {
      itemsHashes: serverItemsHashesToolTextPath,
      txHashes: serverTxHashesToolTextPath,
      itemsServerOnlyChunks: serverItemsServerOnlyChunkToolTextPaths,
      itemsMismatchChunks: serverItemsMismatchChunkToolTextPaths,
      txServerOnly: serverTxServerOnlyToolTextPath,
      txMismatchChunks: serverTxMismatchChunkToolTextPaths,
      projects: serverProjectsToolTextPath,
    },
  },
  reconciliation: {
    items: {
      local: localItemIds.length,
      server: serverItemIds.length,
      localOnly: itemLocalOnlyIds,
      serverOnly: itemServerOnlyIds,
      scalarMismatch: itemScalarMismatchIds,
      imagesMismatch: itemImagesMismatchIds,
      diffs: itemDiffs,
      fieldDiffSummaryTop15: summarizeFieldDiffs(itemDiffs).map(([field, count]) => ({ field, count })),
    },
    transactions: {
      local: localTxIds.length,
      server: serverTxIds.length,
      localOnly: txLocalOnlyIds,
      serverOnly: txServerOnlyIds,
      scalarMismatch: txScalarMismatchIds,
      itemIdsMismatch: txItemIdsMismatchIds,
      imagesMismatch: txImagesMismatchIds,
      diffs: txDiffs,
      fieldDiffSummaryTop15: summarizeFieldDiffs(txDiffs).map(([field, count]) => ({ field, count })),
    },
    projects: {
      local: localProjectIds.length,
      server: serverProjectIds.length,
      localOnly: projectLocalOnlyIds,
      serverOnly: projectServerOnlyIds,
      diffs: projectDiffs,
    },
  },
};

// Markdown report
const mdLines = [];
mdLines.push('## Offline vs Server reconciliation (read-only)');
mdLines.push('');
mdLines.push(`Account: \`${accountId}\`  `);
mdLines.push(`Exported at: \`${exp.exportedAt}\`  `);
mdLines.push(`Report JSON: \`${path.relative(process.cwd(), outJsonPath)}\``);
mdLines.push('');

mdLines.push('### Summary');
mdLines.push(`- **Server items**: ${serverItemIds.length}`);
mdLines.push(`- **Offline items**: ${localItemIds.length}`);
mdLines.push(`- **Offline-only items (missing on server)**: **${itemLocalOnlyIds.length}**`);
mdLines.push(`- **Server-only items (missing offline)**: **${itemServerOnlyIds.length}**`);
mdLines.push(`- **Items with scalar diffs**: **${itemScalarMismatchIds.length}**`);
mdLines.push(`- **Items with images diffs**: **${itemImagesMismatchIds.length}**`);
mdLines.push('');
mdLines.push(`- **Server transactions**: ${serverTxIds.length}`);
mdLines.push(`- **Offline transactions**: ${localTxIds.length}`);
mdLines.push(`- **Offline-only transactions (missing on server)**: **${txLocalOnlyIds.length}**`);
mdLines.push(`- **Server-only transactions (missing offline)**: **${txServerOnlyIds.length}**`);
mdLines.push(`- **Transactions with scalar diffs**: **${txScalarMismatchIds.length}**`);
mdLines.push(`- **Transactions with itemIds diffs**: **${txItemIdsMismatchIds.length}**`);
mdLines.push(`- **Transactions with images diffs**: **${txImagesMismatchIds.length}**`);
mdLines.push('');
mdLines.push(`- **Server projects**: ${serverProjectIds.length}`);
mdLines.push(`- **Offline projects**: ${localProjectIds.length}`);
mdLines.push(`- **Projects missing on server**: **${projectLocalOnlyIds.length}**`);
mdLines.push(`- **Projects missing offline**: **${projectServerOnlyIds.length}**`);
mdLines.push(`- **Projects with diffs**: **${projectDiffs.length}**`);
mdLines.push('');

mdLines.push('### Key findings');
mdLines.push(
  '- The offline export is missing a significant chunk of server state (items + transactions). This usually means the local cache is incomplete or out-of-date for this account on this device.'
);
if (itemScalarMismatchIds.length > 0) {
  const top = reportJson.reconciliation.items.fieldDiffSummaryTop15.slice(0, 8);
  mdLines.push(
    `- For items that exist on both sides, the most common differing fields are: ${top
      .map((x) => `\`${x.field}\` (${x.count})`)
      .join(', ')}`
  );
}
if (txScalarMismatchIds.length > 0) {
  const top = reportJson.reconciliation.transactions.fieldDiffSummaryTop15.slice(0, 8);
  mdLines.push(
    `- For transactions that exist on both sides, the most common differing fields are: ${top
      .map((x) => `\`${x.field}\` (${x.count})`)
      .join(', ')}`
  );
}
mdLines.push('');

mdLines.push('### What’s missing on the server (offline-only)');
if (itemLocalOnlyIds.length === 0 && txLocalOnlyIds.length === 0) {
  mdLines.push('- None found.');
} else {
  if (itemLocalOnlyIds.length > 0) {
    mdLines.push('');
    mdLines.push(`#### Offline-only items (${itemLocalOnlyIds.length})`);
    mdLines.push('');
    const rows = itemLocalOnlyIds.map((id) => {
      const it = localItemById.get(id);
      return {
        itemId: `\`${id}\``,
        description: it?.description ?? '',
        source: it?.source ?? '',
        sku: it?.sku ?? '',
        purchasePrice: it?.purchasePrice ?? '',
        projectPrice: it?.projectPrice ?? '',
        marketValue: it?.marketValue ?? '',
        paymentMethod: it?.paymentMethod ?? '',
        disposition: it?.disposition ?? '',
        dateCreated: it?.dateCreated ?? '',
        lastUpdated: it?.lastUpdated ?? '',
        last_synced_at: it?.last_synced_at ?? '',
        imagesCount: Array.isArray(it?.images) ? String(it.images.length) : '0',
        qrKey: it?.qrKey ? `\`${it.qrKey}\`` : '',
      };
    });
    mdLines.push(
      formatMdTable(rows, [
        { key: 'itemId', label: 'itemId' },
        { key: 'description', label: 'description' },
        { key: 'source', label: 'source' },
        { key: 'sku', label: 'sku' },
        { key: 'purchasePrice', label: 'purchasePrice' },
        { key: 'projectPrice', label: 'projectPrice' },
        { key: 'marketValue', label: 'marketValue' },
        { key: 'paymentMethod', label: 'paymentMethod' },
        { key: 'disposition', label: 'disposition' },
        { key: 'dateCreated', label: 'dateCreated' },
        { key: 'lastUpdated', label: 'lastUpdated' },
        { key: 'last_synced_at', label: 'last_synced_at' },
        { key: 'imagesCount', label: 'imagesCount' },
        { key: 'qrKey', label: 'qrKey' },
      ])
    );
    mdLines.push('');
  }
  if (txLocalOnlyIds.length > 0) {
    mdLines.push('');
    mdLines.push(`#### Offline-only transactions (${txLocalOnlyIds.length})`);
    mdLines.push('');
    mdLines.push(txLocalOnlyIds.map((id) => `- \`${id}\``).join('\n'));
    mdLines.push('');
  }
}

mdLines.push('### What’s missing offline (server-only)');
mdLines.push('');
mdLines.push(`#### Server-only items (${itemServerOnlyIds.length})`);
if (itemServerOnlyIds.length === 0) {
  mdLines.push('- None found.');
} else {
  const serverOnlyRows = itemServerOnlyIds
    .map((id) => serverOnlyItemById.get(id))
    .filter(Boolean)
    .sort((a, b) => normalizeServerTsToMs(b.last_updated) - normalizeServerTsToMs(a.last_updated))
    .slice(0, 30)
    .map((r) => ({
      itemId: `\`${r.item_id}\``,
      description: r.description ?? '',
      source: r.source ?? '',
      sku: r.sku ?? '',
      purchasePrice: r.purchase_price ?? '',
      disposition: r.disposition ?? '',
      dateCreated: r.date_created ?? '',
      lastUpdated: r.last_updated ?? '',
      imagesCount: Array.isArray(r.images) ? String(r.images.length) : '0',
    }));
  mdLines.push('');
  mdLines.push('Top 30 by `last_updated` (full list is in the JSON report under `reconciliation.items.serverOnly`).');
  mdLines.push('');
  mdLines.push(
    formatMdTable(serverOnlyRows, [
      { key: 'itemId', label: 'itemId' },
      { key: 'description', label: 'description' },
      { key: 'source', label: 'source' },
      { key: 'sku', label: 'sku' },
      { key: 'purchasePrice', label: 'purchasePrice' },
      { key: 'disposition', label: 'disposition' },
      { key: 'dateCreated', label: 'dateCreated' },
      { key: 'lastUpdated', label: 'lastUpdated' },
      { key: 'imagesCount', label: 'imagesCount' },
    ])
  );
}
mdLines.push('');
mdLines.push(`#### Server-only transactions (${txServerOnlyIds.length})`);
if (txServerOnlyIds.length === 0) {
  mdLines.push('- None found.');
} else {
  const rows = txServerOnlyIds
    .map((id) => serverOnlyTxById.get(id))
    .filter(Boolean)
    .sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)))
    .map((r) => ({
      transactionId: `\`${r.transaction_id}\``,
      transactionDate: r.transaction_date ?? '',
      source: r.source ?? '',
      amount: r.amount ?? '',
      status: r.status ?? '',
      description: r.description ?? '',
    }));
  mdLines.push('');
  mdLines.push(
    formatMdTable(rows, [
      { key: 'transactionId', label: 'transactionId' },
      { key: 'transactionDate', label: 'transactionDate' },
      { key: 'source', label: 'source' },
      { key: 'amount', label: 'amount' },
      { key: 'status', label: 'status' },
      { key: 'description', label: 'description' },
    ])
  );
}
mdLines.push('');

mdLines.push('### Items that exist on both sides but differ');
mdLines.push('');
mdLines.push(`- Total: **${itemDiffs.length}**`);
if (itemDiffs.length === 0) {
  mdLines.push('- None found.');
} else {
  mdLines.push('- Full per-field diffs are in the JSON report under `reconciliation.items.diffs`.');
  mdLines.push(
    `- IDs: ${itemDiffs
      .map((d) => `\`${d.itemId}\``)
      .slice(0, 60)
      .join(', ')}${itemDiffs.length > 60 ? ', ...' : ''}`
  );
}
mdLines.push('');

mdLines.push('### Transactions that exist on both sides but differ');
mdLines.push('');
mdLines.push(`- Total: **${txDiffs.length}**`);
if (txDiffs.length === 0) {
  mdLines.push('- None found.');
} else {
  mdLines.push('- Full per-field diffs are in the JSON report under `reconciliation.transactions.diffs`.');
  mdLines.push(
    `- IDs: ${txDiffs
      .map((d) => `\`${d.transactionId}\``)
      .slice(0, 60)
      .join(', ')}${txDiffs.length > 60 ? ', ...' : ''}`
  );
}
mdLines.push('');

mdLines.push('### Notes');
mdLines.push(
  '- This report is read-only: it only compares the offline export to server rows. No DB writes are performed.'
);
mdLines.push(
  '- Timestamp comparisons are normalized by converting both sides to epoch-milliseconds before comparing.'
);
mdLines.push(
  '- Numeric tax rate comparisons are normalized to 4 decimal places (matching Postgres numeric text formatting).'
);
mdLines.push('');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outJsonPath, JSON.stringify(reportJson, null, 2) + '\n', 'utf8');
fs.writeFileSync(outMdPath, mdLines.join('\n') + '\n', 'utf8');

console.log(`Wrote ${outMdPath}`);
console.log(`Wrote ${outJsonPath}`);
