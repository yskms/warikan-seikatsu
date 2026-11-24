// メンバーと招待の画面（`ui/settings/MembersScreen.tsx`）に出す内容の組み立て。サーバーの値を、文字と並びにするだけで、
// 人数の判定・脱退の確定の判断はしない（`canInvite`・各メンバーの `status` は、サーバーの値。CLAUDE.md）。
import type { GroupDetail, GroupMember } from '../domain/group.ts';
import type { Invite } from '../domain/invite.ts';
import { formatMonthShort, nextMonth } from './dateFormat.ts';
import { initialOf } from './homeView.ts';

export interface MemberRow {
  id: string;
  name: string;
  initial: string;
  /** メンバーの色のキー（知らないキーは、画面が灰色にする） */
  color: string;
  isMe: boolean;
  /** 状態の文言。参加中（脱退を選んでいない）・知らない状態は `null`（何も添えない） */
  statusLabel: string | null;
}

export interface MemberList {
  /** いまグループにいる人（参加中・脱退を選んだ・脱退が確定して精算が残っている人。知らない状態を含む）。自分が先 */
  current: MemberRow[];
  /** 脱退済み・アカウントを削除した人（名前は残る）。薄く出す */
  former: MemberRow[];
}

/**
 * 状態の文言。`active` で脱退月がある人は、脱退を選んだだけ（月を締めるか翌月1日に確定する。取り消せる）。`leaving` は、脱退が確定
 * したが、関わる送金が未処理のため、メンバーに残っている（docs/backend-design.md 5章）。**知らない状態（`unknown`）は、
 * 何も添えず、いるメンバーとして出す**（いまの画面は、メンバーの状態で操作の可否を決めない。招待できるかは、サーバーの `canInvite`）。
 */
export function memberStatusLabel(member: Pick<GroupMember, 'status' | 'leaveRequestedMonth'>): string | null {
  switch (member.status) {
    case 'active': {
      if (member.leaveRequestedMonth === null) return null;
      const month = formatMonthShort(member.leaveRequestedMonth);
      const next = nextMonth(member.leaveRequestedMonth);
      const confirmDay = next === null ? '翌月1日' : `${formatMonthShort(next)}1日`;
      return `${month}で脱退予定（${month}を締めるか、${confirmDay}に確定）`;
    }
    case 'leaving':
      return '脱退が確定（精算が残っています）';
    case 'left':
      return '脱退済み';
    case 'deleted':
      // 名前は、サーバーが「削除されたユーザー」にしている。文言を重ねない
      return null;
    case 'unknown':
      return null;
  }
}

function isFormer(member: Pick<GroupMember, 'status'>): boolean {
  return member.status === 'left' || member.status === 'deleted';
}

/** メンバーの一覧。いる人（自分が先、あとはサーバーの並び）と、以前の人（名前が残っている）に分ける。 */
export function buildMemberList(members: readonly GroupMember[]): MemberList {
  const rows = members.map((member): { row: MemberRow; former: boolean } => ({
    former: isFormer(member),
    row: {
      id: member.id,
      name: member.displayName,
      initial: initialOf(member.displayName),
      color: member.color,
      isMe: member.isMe,
      statusLabel: memberStatusLabel(member),
    },
  }));
  const mineFirst = (a: { row: MemberRow }, b: { row: MemberRow }) => Number(b.row.isMe) - Number(a.row.isMe);
  return {
    current: rows.filter((entry) => !entry.former).sort(mineFirst).map((entry) => entry.row),
    former: rows.filter((entry) => entry.former).map((entry) => entry.row),
  };
}

export interface InviteSection {
  /** 招待の欄を出すか。自分の脱退が確定しているときは出さない（docs/screens.md 6章） */
  visible: boolean;
  /** 「招待する」を押せるか（サーバーの `canInvite`） */
  canInvite: boolean;
  /** 押せないときの理由（押せるときは `null`） */
  note: string | null;
}

/** 招待の欄の出し分け。人数の判定は書き写さず、サーバーの `canInvite` と、人数の値（満員の説明にだけ使う）を使う。 */
export function buildInviteSection(group: Pick<GroupDetail, 'memberId' | 'members' | 'canInvite' | 'seatedMembers' | 'maxMembers'>): InviteSection {
  const me = group.members.find((member) => member.id === group.memberId);
  // 自分の脱退が確定している（`leaving` 以降）と、招待できない。そもそも欄を出さない
  if (me !== undefined && (me.status === 'leaving' || me.status === 'left' || me.status === 'deleted')) {
    return { visible: false, canInvite: false, note: null };
  }
  if (group.canInvite) return { visible: true, canInvite: true, note: null };
  const full = group.seatedMembers >= group.maxMembers;
  return {
    visible: true,
    canInvite: false,
    note: full ? `1つのグループは${group.maxMembers}人までです。` : 'いまは、招待できません。',
  };
}

const MINUTE = 60_000;

/**
 * 招待の期限の表示（あと2日5時間、など）。期限は、端末の時計との差で出す（タイムゾーンに依らない）。発行した直後（期限まで3日）が
 * 「あと2日23時間」と出ないよう、**分は切り上げてから**、日・時間に分ける（見せる値が、実際より1分未満長くなるだけ）。
 */
export function formatInviteExpiry(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) return '期限切れ';
  if (left < MINUTE) return 'まもなく期限切れ';
  const minutes = Math.ceil(left / MINUTE);
  if (minutes >= 24 * 60) {
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return hours === 0 ? `あと${days}日` : `あと${days}日${hours}時間`;
  }
  if (minutes >= 60) return `あと${Math.floor(minutes / 60)}時間`;
  return `あと${minutes}分`;
}

/** 招待の一覧の並び（新しく発行したものが上）。 */
export function sortInvites(invites: readonly Invite[]): Invite[] {
  return [...invites].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
}
