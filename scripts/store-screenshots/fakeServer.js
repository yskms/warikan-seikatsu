// ストア用のスクリーンショットを撮るための、偽のサーバー（読み取りだけ）。アプリの `fetch` をこれに差し替えて、
// 本番のWorkerに通信せずに、仮名のデータで画面を出す。`fake.js` が差し込む（使い方は docs/store-listing.md 4章）。
//
// **出荷するビルドには入れない。** `package.json` の `main` を `scripts/store-screenshots/entry.js` に替えたときだけ、
// アプリに入る（`fake-mode.sh`。ふだんの `main` は `expo-router/entry`。`src/appConfig.test.ts` が固定している）。
//
// 応答の形は、アプリのRepositoryが読む項目（`src/repositories/*.ts`）と、そのテストの例に合わせてある。
// 金額・割合は、ここで計算する（合計や送金額が、画面の中で食い違わないように）。
//
// 作り物の注意（画面に出ない範囲で、現実の状態とずれている）: 月の一覧は、10月を「精算済み」にしているが、10月の集計は、送金が
// 未処理（精算完了・繰越の操作が出る）のまま。本物のWorkerは、未処理の送金がある月を「精算済み」にしない。11月を「締められる」と
// 答えるのも、同じ（前の月を精算するまで、本物のWorkerは締めさせない）。月の一覧を「未精算」にすると、ホームの上に
// 「10月分の精算が残っています」の帯が出て、11月の画面が散らかる。1つのビルドで、「締める前の月」と「締めた後の月（精算完了・
// 繰越の操作）」の両方を撮るため。
//
// 人名・金額・品名は、すべて架空（実在の人名を、宣伝の画像に載せない）。

const GROUP_ID = 'g1';
const ME = 'm1';
const PARTNER = 'm2';
const CURRENT_MONTH = '2026-11';

const MEMBERS = [
  {
    id: ME,
    displayName: 'あなた',
    color: 'pink',
    status: 'active',
    historyFromMonth: '2026-09',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    leaveEffective: false,
    isMe: true,
  },
  {
    id: PARTNER,
    displayName: 'ゆうな',
    color: 'blue',
    status: 'active',
    historyFromMonth: '2026-09',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    leaveEffective: false,
    isMe: false,
  },
];

const GROUP = {
  id: GROUP_ID,
  name: 'ふたりの生活費',
  currencyCode: 'JPY',
  currencyMinorUnit: 0,
  timezone: 'Asia/Tokyo',
  createdAt: Date.UTC(2026, 8, 1),
  memberId: ME,
  currencyLocked: true,
  leaveDeletesGroup: false,
  seatedMembers: 2,
  maxMembers: 5,
  canInvite: true,
  members: MEMBERS,
};

const GROUP_LIST_ITEM = {
  id: GROUP_ID,
  name: GROUP.name,
  currencyCode: 'JPY',
  currencyMinorUnit: 0,
  timezone: 'Asia/Tokyo',
  createdAt: GROUP.createdAt,
  memberId: ME,
  memberStatus: 'active',
  historyFromMonth: '2026-09',
  leaveRequestedMonth: null,
  expenseEndMonth: null,
};

// 初期の費目（`worker/src/groups.ts` の `DEFAULT_CATEGORIES`）と同じ名前・アイコン・色。
const CATEGORIES = [
  { id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archivedAt: null },
  { id: 'c2', name: '食費', icon: 'cart', color: 'green', sortOrder: 2, archivedAt: null },
  { id: 'c3', name: '日用品', icon: 'detergent', color: 'teal', sortOrder: 3, archivedAt: null },
  { id: 'c4', name: '光熱費', icon: 'bulb', color: 'yellow', sortOrder: 4, archivedAt: null },
  { id: 'c5', name: '外食', icon: 'utensils', color: 'orange', sortOrder: 5, archivedAt: null },
  { id: 'c6', name: '通信費', icon: 'wifi', color: 'purple', sortOrder: 6, archivedAt: null },
  { id: 'c7', name: 'その他', icon: 'more', color: 'gray', sortOrder: 7, archivedAt: null },
];

// 費目ごとの負担割合（1万分率。あなた : ゆうな）。外食だけ、あなたが月1万円まで全額を負担し、超えた分はゆうなが負担する。
const RULES = {
  c1: { shares: [7000, 3000], cap: null },
  c2: { shares: [5000, 5000], cap: null },
  c3: { shares: [5000, 5000], cap: null },
  c4: { shares: [6000, 4000], cap: null },
  c5: { shares: [0, 10000], cap: { memberId: ME, capMinor: 10000 } },
  c6: { shares: [5000, 5000], cap: null },
  c7: { shares: [5000, 5000], cap: null },
};

// [日付, 内容, 費目, 金額, 支払った人]
const EXPENSE_ROWS = {
  '2026-11': [
    ['2026-11-01', '家賃', 'c1', 98000, ME],
    ['2026-11-03', 'スーパー', 'c2', 4280, PARTNER],
    ['2026-11-05', 'ドラッグストア', 'c3', 2860, ME],
    ['2026-11-08', '電気・ガス', 'c4', 11400, PARTNER],
    ['2026-11-09', 'ランチ', 'c5', 3600, ME],
    ['2026-11-12', 'ネット回線', 'c6', 5200, PARTNER],
    ['2026-11-15', 'スーパー', 'c2', 6150, ME],
    ['2026-11-18', 'ディナー', 'c5', 7800, PARTNER],
    ['2026-11-22', 'ホームセンター', 'c3', 3480, PARTNER],
    ['2026-11-24', 'スーパー', 'c2', 5320, ME],
  ],
  '2026-10': [
    ['2026-10-01', '家賃', 'c1', 98000, ME],
    ['2026-10-04', 'スーパー', 'c2', 5870, PARTNER],
    ['2026-10-07', 'ドラッグストア', 'c3', 3120, ME],
    ['2026-10-10', '電気・ガス', 'c4', 9800, PARTNER],
    ['2026-10-13', 'ランチ', 'c5', 4400, ME],
    ['2026-10-16', 'スーパー', 'c2', 7320, ME],
    ['2026-10-20', 'ネット回線', 'c6', 5200, PARTNER],
    ['2026-10-26', 'ディナー', 'c5', 6900, PARTNER],
    ['2026-10-29', 'スーパー', 'c2', 4160, PARTNER],
  ],
  '2026-09': [],
};

const CLOSED_MONTHS = new Set(['2026-09', '2026-10']);
// 画面収録のために、締める・精算の書き込みを受けて、状態を変える（アプリを起動し直すと、元に戻る）。
// 送金の状態: id -> 'pending' | 'settled' | 'carried'
const TRANSFER_STATE = new Map();

function expensesOf(month) {
  const rows = EXPENSE_ROWS[month] ?? [];
  return rows
    .map(([expenseDate, description, categoryId, amountMinor, payerMemberId], index) => ({
      id: `e-${month}-${index + 1}`,
      expenseDate,
      targetMonth: month,
      description,
      amountMinor,
      categoryId,
      payerMemberId,
      createdByMemberId: payerMemberId,
      recurringExpenseId: null,
      splitMethod: 'category',
      allocations: [],
      createdAt: Date.UTC(2026, 8, 1),
      updatedAt: Date.UTC(2026, 8, 1),
    }))
    .sort((a, b) => (a.expenseDate < b.expenseDate ? 1 : -1));
}

/** 費目の合計を、負担割合（と上限額）で、あなた・ゆうなの負担額に分ける。端数は、あなたに1円ずつ寄せる。 */
function burdenOf(categoryId, totalMinor) {
  const rule = RULES[categoryId];
  const split = (amount) => {
    const mine = Math.floor((amount * rule.shares[0]) / 10000);
    return [mine, amount - mine];
  };
  if (rule.cap === null) return split(totalMinor);
  const capped = Math.min(totalMinor, rule.cap.capMinor);
  const [mineExcess, partnerExcess] = split(totalMinor - capped);
  return rule.cap.memberId === ME ? [capped + mineExcess, partnerExcess] : [mineExcess, capped + partnerExcess];
}

/** 締めた月の送金の状態（締めたあと、精算・繰越の書き込みで変わる。既定は未処理）。 */
function transferStatus(month) {
  return TRANSFER_STATE.get(`t-${month}`) ?? 'pending';
}

/** 月の一覧の状態（保存せず、締めと送金の状態から毎回導く） */
function monthStatus(month) {
  if (!CLOSED_MONTHS.has(month)) return 'open';
  return month === '2026-10' || transferStatus(month) !== 'pending' ? 'settled' : 'unsettled';
}

function monthView(month) {
  const closed = CLOSED_MONTHS.has(month);
  const expenses = expensesOf(month);
  const paid = { [ME]: 0, [PARTNER]: 0 };
  const totals = new Map();
  for (const expense of expenses) {
    paid[expense.payerMemberId] += expense.amountMinor;
    totals.set(expense.categoryId, (totals.get(expense.categoryId) ?? 0) + expense.amountMinor);
  }
  const categories = [];
  const burden = { [ME]: 0, [PARTNER]: 0 };
  for (const category of CATEGORIES) {
    const total = totals.get(category.id);
    if (total === undefined) continue;
    const [mine, partner] = burdenOf(category.id, total);
    burden[ME] += mine;
    burden[PARTNER] += partner;
    categories.push({
      categoryId: category.id,
      totalMinor: total,
      burdens: [
        { memberId: ME, burdenMinor: mine },
        { memberId: PARTNER, burdenMinor: partner },
      ],
    });
  }
  const members = MEMBERS.map((member) => {
    const difference = paid[member.id] - burden[member.id];
    return {
      memberId: member.id,
      displayName: member.displayName,
      paidMinor: paid[member.id],
      burdenMinor: burden[member.id],
      differenceMinor: difference,
      carriedInMinor: 0,
      netMinor: difference,
    };
  });
  // 払いすぎた人へ、足りない人から送る（2人のとき1件）。
  const creditor = members.find((member) => member.netMinor > 0);
  const debtor = members.find((member) => member.netMinor < 0);
  const transfers =
    creditor && debtor && !closed
      ? [{ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amountMinor: creditor.netMinor }]
      : creditor && debtor
        ? [
            {
              id: `t-${month}`,
              fromMemberId: debtor.memberId,
              toMemberId: creditor.memberId,
              amountMinor: creditor.netMinor,
              status: transferStatus(month),
              settledAt: transferStatus(month) === 'settled' ? Date.UTC(2026, 10, 27) : null,
              carriedAt: transferStatus(month) === 'carried' ? Date.UTC(2026, 10, 27) : null,
              processedByMemberId: transferStatus(month) === 'pending' ? null : ME,
              canCarry: transferStatus(month) === 'pending',
            },
          ]
        : [];
  return {
    month,
    closed,
    closing: closed
      ? { id: `cl-${month}`, closedAt: Date.UTC(2026, 9, 31, 12), closedByMemberId: ME, processed: transferStatus(month) !== 'pending' }
      : null,
    totalMinor: expenses.reduce((sum, expense) => sum + expense.amountMinor, 0),
    members,
    categories,
    transfers,
    close: closed ? { closable: false, reason: 'month_closed' } : { closable: true, deletesGroup: false },
  };
}

function sharesView(month) {
  return {
    month,
    closed: CLOSED_MONTHS.has(month),
    editable: !CLOSED_MONTHS.has(month),
    memberIds: [ME, PARTNER],
    categories: CATEGORIES.map((category) => {
      const rule = RULES[category.id];
      return {
        categoryId: category.id,
        sourceMonth: '2026-09',
        shares: [
          { memberId: ME, basisPoints: rule.shares[0] },
          { memberId: PARTNER, basisPoints: rule.shares[1] },
        ],
        cap: rule.cap,
        archived: false,
        memberChangedAt: null,
        memberChangeKind: null,
      };
    }),
  };
}

// 毎月の固定費（家賃・ネット回線などは費目の負担割合どおり。動画配信・音楽配信は2人で均等）
const RECURRING = [
  recurring('r1', '家賃', 98000, 'c1', ME, { method: 'category' }, 1),
  recurring('r2', 'ネット回線', 5200, 'c6', PARTNER, { method: 'category' }, 12),
  recurring('r3', '水道代', 3200, 'c4', PARTNER, { method: 'category' }, 15),
  recurring('r4', '動画配信', 1490, 'c7', ME, { method: 'equal', memberIds: [ME, PARTNER] }, 20),
  recurring('r5', '音楽配信', 980, 'c7', ME, { method: 'equal', memberIds: [ME, PARTNER] }, 20),
  recurring('r6', '日用品の定期便', 2980, 'c3', ME, { method: 'category' }, 25),
];

function recurring(id, description, amountMinor, categoryId, payerMemberId, split, dayOfMonth) {
  return {
    id,
    description,
    amountMinor,
    categoryId,
    categoryArchived: false,
    payerMemberId,
    split,
    dayOfMonth,
    startMonth: '2026-09',
    endMonth: null,
    pausedAt: null,
    pausedReason: null,
  };
}

/** `url` から、パスとクエリを取り出す（RNの `URL` に頼らない）。 */
function parse(url) {
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, '');
  const [path, query = ''] = withoutOrigin.split('?');
  const params = {};
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const [key, value = ''] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return { segments: path.split('/').filter(Boolean), params };
}

function route(method, url) {
  const { segments, params } = parse(url);
  if (method === 'POST') {
    // 締める: POST /groups/g1/months/2026-11/close（11月だけ）
    if (segments[0] === 'groups' && segments[1] === GROUP_ID && segments[2] === 'months' && segments[4] === 'close') {
      if (segments[3] !== '2026-11' || CLOSED_MONTHS.has('2026-11')) return { status: 409, body: { error: 'conflict' } };
      CLOSED_MONTHS.add('2026-11');
      return { status: 201, body: monthView('2026-11') };
    }
    // 精算完了・繰越: POST /transfers/t-2026-11/settle|carry
    if (segments[0] === 'transfers' && (segments[2] === 'settle' || segments[2] === 'carry')) {
      TRANSFER_STATE.set(segments[1], segments[2] === 'settle' ? 'settled' : 'carried');
      return { status: 200, body: { transfer: { id: segments[1] } } };
    }
    return { status: 404, body: { error: 'not_found' } };
  }
  if (method !== 'GET') return { status: 404, body: { error: 'not_found' } };
  if (segments.length === 1 && segments[0] === 'groups') return { status: 200, body: { groups: [GROUP_LIST_ITEM] } };
  if (segments[0] !== 'groups' || segments[1] !== GROUP_ID) return { status: 404, body: { error: 'not_found' } };
  const rest = segments.slice(2).join('/');
  if (rest === '') return { status: 200, body: { group: GROUP } };
  if (rest === 'months') {
    return {
      status: 200,
      body: {
        currentMonth: CURRENT_MONTH,
        months: [
          { month: '2026-09', status: 'settled' },
          { month: '2026-10', status: 'settled' },
          { month: '2026-11', status: monthStatus('2026-11') },
        ],
      },
    };
  }
  if (/^months\/\d{4}-\d{2}\/summary$/.test(rest)) return { status: 200, body: monthView(segments[3]) };
  if (/^months\/\d{4}-\d{2}\/category-shares$/.test(rest)) return { status: 200, body: sharesView(segments[3]) };
  if (rest === 'expenses') {
    const month = params.month;
    return { status: 200, body: { month, closed: CLOSED_MONTHS.has(month), expenses: expensesOf(month) } };
  }
  if (rest === 'categories') return { status: 200, body: { categories: CATEGORIES } };
  if (rest === 'recurring-expenses') return { status: 200, body: { recurringExpenses: RECURRING } };
  if (rest === 'invites') return { status: 200, body: { invites: [] } };
  return { status: 404, body: { error: 'not_found' } };
}

/** アプリの `fetch` の代わり。応答は、すぐ返す。 */
export function fakeFetch(url, init) {
  const { status, body } = route(init.method, url);
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}
