// 入口。エンドポイントは docs/backend-design.md 9章の順に足す。
import { handleAppleNotification } from './appleNotification.ts';
import { handleAppleCallback, handleAppleWebLogin } from './appleWeb.ts';
import { handleLogin, handleLogout, handleNonce } from './auth.ts';
import {
  handleAcknowledgeSharesReset,
  handleCreateCategory,
  handleGetCategoryRules,
  handleListCategories,
  handlePutCategoryRule,
  handleReorderCategories,
  handleResetSharesToEqual,
  handleUpdateCategory,
} from './categories.ts';
import { handleCloseMonth, handleGetClosing, handleMonthSummary } from './closings.ts';
import { runScheduled } from './cron.ts';
import { handleDeleteAccount } from './deleteAccount.ts';
import { isId } from './expenseInput.ts';
import { handleCreateExpense, handleDeleteExpense, handleListExpenses, handleUpdateExpense } from './expenses.ts';
import {
  handleCreateGroup,
  handleGetGroup,
  handleListGroups,
  handleUpdateGroup,
  handleUpdateMe,
} from './groups.ts';
import { methodNotAllowed, notFound } from './http.ts';
import { httpsRequiredResponse, isInsecureRequest } from './https.ts';
import {
  handleCreateInvite,
  handleGetInvite,
  handleJoin,
  handleListInvites,
  handleRevokeInvite,
  isInviteToken,
} from './invites.ts';
import { handleCancelLeave, handleRequestLeave } from './leave.ts';
import { handleListMonths } from './monthList.ts';
import { isMonth } from './months.ts';
import { handleCreateRecurring, handleDeleteRecurring, handleListRecurring, handleUpdateRecurring } from './recurring.ts';
import { handleSite } from './site.ts';
import { handleProcessTransfer } from './transfers.ts';

const GROUPS_PATH = /^\/groups$/;
const GROUP_PATH = /^\/groups\/([^/]+)$/;
const GROUP_ME_PATH = /^\/groups\/([^/]+)\/members\/me$/;
const GROUP_CATEGORIES_PATH = /^\/groups\/([^/]+)\/categories$/;
const GROUP_CATEGORIES_ORDER_PATH = /^\/groups\/([^/]+)\/categories\/order$/;
const CATEGORY_PATH = /^\/categories\/([^/]+)$/;
const GROUP_SHARES_RESET_PATH = /^\/groups\/([^/]+)\/category-shares\/acknowledge-reset$/;
const GROUP_SHARES_EQUAL_PATH = /^\/groups\/([^/]+)\/category-shares\/reset-equal$/;
const GROUP_CATEGORY_RULES_PATH = /^\/groups\/([^/]+)\/months\/([^/]+)\/category-shares$/;
const GROUP_CATEGORY_RULE_PATH = /^\/groups\/([^/]+)\/months\/([^/]+)\/category-shares\/([^/]+)$/;
const GROUP_EXPENSES_PATH = /^\/groups\/([^/]+)\/expenses$/;
const EXPENSE_PATH = /^\/expenses\/([^/]+)$/;
const GROUP_RECURRING_PATH = /^\/groups\/([^/]+)\/recurring-expenses$/;
const RECURRING_PATH = /^\/recurring-expenses\/([^/]+)$/;
const GROUP_MONTHS_PATH = /^\/groups\/([^/]+)\/months$/;
const GROUP_MONTH_PATH = /^\/groups\/([^/]+)\/months\/([^/]+)\/(summary|close|closing)$/;
const TRANSFER_PATH = /^\/transfers\/([^/]+)\/(settle|carry)$/;
const GROUP_INVITES_PATH = /^\/groups\/([^/]+)\/invites$/;
const GROUP_LEAVE_PATH = /^\/groups\/([^/]+)\/leave$/;
// `/invites/:x` は、GET が招待トークン、DELETE が招待のID。
const INVITE_PATH = /^\/invites\/([^/]+)$/;
const INVITE_JOIN_PATH = /^\/invites\/([^/]+)\/join$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 何よりも先に、HTTPSでないリクエストを、中身を見ずに拒否する（src/https.ts）。
    if (isInsecureRequest(request)) return httpsRequiredResponse();

    const { pathname } = new URL(request.url);
    const now = Date.now();
    // 公開のWeb（招待URLの案内ページ・Universal Links / App Links の設定ファイル）。APIの規則（セッション・JSON）とは別なので、先に見る。
    const site = await handleSite(request, env);
    if (site !== null) return site;

    // 認証（docs/backend-design.md 9章の「認証API」）。セッションを要らない入口はここだけ（招待の確認以降は要る）。
    if (pathname === '/auth/nonce') return handleNonce(request, env, now);
    if (pathname === '/auth/login') return handleLogin(request, env, now);
    if (pathname === '/auth/logout') return handleLogout(request, env, now);
    if (pathname === '/auth/delete') return handleDeleteAccount(request, env, now);
    // AndroidのAppleログイン（Web経由）。コールバックは、Appleのリダイレクトを、アプリのURLスキームへ戻すだけ。
    if (pathname === '/auth/apple/callback') return handleAppleCallback(request);
    if (pathname === '/auth/apple/login') return handleAppleWebLogin(request, env, now);
    // Appleのサーバー間通知（連携の解除・Apple Accountの削除）。署名を確かめてから処理する（セッションは要らない）。
    if (pathname === '/auth/apple/notifications') return handleAppleNotification(request, env, now);

    if (GROUPS_PATH.test(pathname)) {
      if (request.method === 'GET') return handleListGroups(request, env, now);
      if (request.method === 'POST') return handleCreateGroup(request, env, now);
      return methodNotAllowed('GET, POST');
    }

    const group = GROUP_PATH.exec(pathname);
    if (group !== null) {
      const groupId = group[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'GET') return handleGetGroup(request, env, now, groupId);
      if (request.method === 'PATCH') return handleUpdateGroup(request, env, now, groupId);
      return methodNotAllowed('GET, PATCH');
    }

    const groupMe = GROUP_ME_PATH.exec(pathname);
    if (groupMe !== null) {
      const groupId = groupMe[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'PATCH') return handleUpdateMe(request, env, now, groupId);
      return methodNotAllowed('PATCH');
    }

    const groupCategories = GROUP_CATEGORIES_PATH.exec(pathname);
    if (groupCategories !== null) {
      const groupId = groupCategories[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'GET') return handleListCategories(request, env, now, groupId);
      if (request.method === 'POST') return handleCreateCategory(request, env, now, groupId);
      return methodNotAllowed('GET, POST');
    }

    const categoriesOrder = GROUP_CATEGORIES_ORDER_PATH.exec(pathname);
    if (categoriesOrder !== null) {
      const groupId = categoriesOrder[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'PUT') return handleReorderCategories(request, env, now, groupId);
      return methodNotAllowed('PUT');
    }

    const category = CATEGORY_PATH.exec(pathname);
    if (category !== null) {
      const categoryId = category[1]!;
      if (!isId(categoryId)) return notFound();
      if (request.method === 'PATCH') return handleUpdateCategory(request, env, now, categoryId);
      return methodNotAllowed('PATCH');
    }

    const sharesReset = GROUP_SHARES_RESET_PATH.exec(pathname);
    if (sharesReset !== null) {
      const groupId = sharesReset[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'POST') return handleAcknowledgeSharesReset(request, env, now, groupId);
      return methodNotAllowed('POST');
    }

    const sharesEqual = GROUP_SHARES_EQUAL_PATH.exec(pathname);
    if (sharesEqual !== null) {
      const groupId = sharesEqual[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'POST') return handleResetSharesToEqual(request, env, now, groupId);
      return methodNotAllowed('POST');
    }

    const categoryRules = GROUP_CATEGORY_RULES_PATH.exec(pathname);
    if (categoryRules !== null) {
      const groupId = categoryRules[1]!;
      const month = categoryRules[2]!;
      if (!isId(groupId) || !isMonth(month)) return notFound();
      if (request.method === 'GET') return handleGetCategoryRules(request, env, now, groupId, month);
      return methodNotAllowed('GET');
    }

    const categoryRule = GROUP_CATEGORY_RULE_PATH.exec(pathname);
    if (categoryRule !== null) {
      const groupId = categoryRule[1]!;
      const month = categoryRule[2]!;
      const categoryId = categoryRule[3]!;
      if (!isId(groupId) || !isMonth(month) || !isId(categoryId)) return notFound();
      if (request.method === 'PUT') return handlePutCategoryRule(request, env, now, groupId, month, categoryId);
      return methodNotAllowed('PUT');
    }

    const groupExpenses = GROUP_EXPENSES_PATH.exec(pathname);
    if (groupExpenses !== null) {
      const groupId = groupExpenses[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'GET') return handleListExpenses(request, env, now, groupId);
      if (request.method === 'POST') return handleCreateExpense(request, env, now, groupId);
      return methodNotAllowed('GET, POST');
    }

    const expense = EXPENSE_PATH.exec(pathname);
    if (expense !== null) {
      const expenseId = expense[1]!;
      if (!isId(expenseId)) return notFound();
      if (request.method === 'PATCH') return handleUpdateExpense(request, env, now, expenseId);
      if (request.method === 'DELETE') return handleDeleteExpense(request, env, now, expenseId);
      return methodNotAllowed('PATCH, DELETE');
    }

    const groupRecurring = GROUP_RECURRING_PATH.exec(pathname);
    if (groupRecurring !== null) {
      const groupId = groupRecurring[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'GET') return handleListRecurring(request, env, now, groupId);
      if (request.method === 'POST') return handleCreateRecurring(request, env, now, groupId);
      return methodNotAllowed('GET, POST');
    }

    const recurring = RECURRING_PATH.exec(pathname);
    if (recurring !== null) {
      const recurringId = recurring[1]!;
      if (!isId(recurringId)) return notFound();
      if (request.method === 'PATCH') return handleUpdateRecurring(request, env, now, recurringId);
      if (request.method === 'DELETE') return handleDeleteRecurring(request, env, now, recurringId);
      return methodNotAllowed('PATCH, DELETE');
    }

    const groupMonths = GROUP_MONTHS_PATH.exec(pathname);
    if (groupMonths !== null) {
      const groupId = groupMonths[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'GET') return handleListMonths(request, env, now, groupId);
      return methodNotAllowed('GET');
    }

    const groupMonth = GROUP_MONTH_PATH.exec(pathname);
    if (groupMonth !== null) {
      const groupId = groupMonth[1]!;
      const month = groupMonth[2]!;
      if (!isId(groupId) || !isMonth(month)) return notFound();
      switch (groupMonth[3]) {
        case 'summary':
          if (request.method === 'GET') return handleMonthSummary(request, env, now, groupId, month);
          return methodNotAllowed('GET');
        case 'closing':
          if (request.method === 'GET') return handleGetClosing(request, env, now, groupId, month);
          return methodNotAllowed('GET');
        default:
          if (request.method === 'POST') return handleCloseMonth(request, env, now, groupId, month);
          return methodNotAllowed('POST');
      }
    }

    const transfer = TRANSFER_PATH.exec(pathname);
    if (transfer !== null) {
      const transferId = transfer[1]!;
      if (!isId(transferId)) return notFound();
      if (request.method !== 'POST') return methodNotAllowed('POST');
      return handleProcessTransfer(request, env, now, transferId, transfer[2] === 'settle' ? 'settle' : 'carry');
    }

    const groupInvites = GROUP_INVITES_PATH.exec(pathname);
    if (groupInvites !== null) {
      const groupId = groupInvites[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'GET') return handleListInvites(request, env, now, groupId);
      if (request.method === 'POST') return handleCreateInvite(request, env, now, groupId);
      return methodNotAllowed('GET, POST');
    }

    const groupLeave = GROUP_LEAVE_PATH.exec(pathname);
    if (groupLeave !== null) {
      const groupId = groupLeave[1]!;
      if (!isId(groupId)) return notFound();
      if (request.method === 'POST') return handleRequestLeave(request, env, now, groupId);
      if (request.method === 'DELETE') return handleCancelLeave(request, env, now, groupId);
      return methodNotAllowed('POST, DELETE');
    }

    const invite = INVITE_PATH.exec(pathname);
    if (invite !== null) {
      const value = invite[1]!;
      if (request.method === 'GET') return isInviteToken(value) ? handleGetInvite(request, env, now, value) : notFound();
      if (request.method === 'DELETE') return isId(value) ? handleRevokeInvite(request, env, now, value) : notFound();
      return methodNotAllowed('GET, DELETE');
    }

    const inviteJoin = INVITE_JOIN_PATH.exec(pathname);
    if (inviteJoin !== null) {
      const token = inviteJoin[1]!;
      if (!isInviteToken(token)) return notFound();
      if (request.method === 'POST') return handleJoin(request, env, now, token);
      return methodNotAllowed('POST');
    }

    // 他の404と同じ形にする（アプリがエラーをJSONとして読めるように）。
    return notFound();
  },

  // 1時間ごとの定期処理（wrangler.jsonc の triggers。docs/backend-design.md 7章）。
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
