export interface ProbeState {
  namespace: string;
  uid: string;
  workerId: string;
  calendar: { status: 'creating' } | { status: 'ready'; id: string };
  event: { id: string; start: string; end: string };
}

export interface ProbeResult {
  steps: { stage: string; status: 'ok' | 'error'; code: string; message: string }[];
  uidPrefix?: string;
  sameUid?: boolean;
  workerChanged?: boolean;
  calendarName?: string;
  eventId?: string;
}

export interface ProbeDependencies {
  missing: string[];
  workerId: string;
  namespace: string;
  auth: {
    restore(): Promise<string | null>;
    getToken(): Promise<string>;
    credential(idToken: null, accessToken: string): unknown;
    signIn(credential: unknown): Promise<string>;
  };
  read(): Promise<ProbeState | undefined>;
  write(state: ProbeState | undefined): Promise<void>;
  newEventId(): string;
  now(): Date;
  request(path: string, token: string, body?: object): Promise<{ status: number; data?: unknown }>;
}

const calendarName = 'ToDoku・接続テスト';
const eventName = 'ToDokuの接続テスト（架空の予定）';

/** Only the transport adapter can establish that dispatch never started. */
export class RequestNotSent extends Error {}

class ProbeFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function eventBody(event: ProbeState['event']) {
  return {
    id: event.id,
    summary: eventName,
    start: { dateTime: event.start },
    end: { dateTime: event.end },
    transparency: 'transparent',
    reminders: { useDefault: false },
    extendedProperties: { private: { authProbe: event.id } },
  };
}

function matchesEvent(data: unknown, event: ProbeState['event']): boolean {
  const value = record(data);
  const sameSecond = (actual: unknown, expected: string) => {
    const actualTime = Date.parse(String(actual));
    const expectedTime = Date.parse(expected);
    return Number.isFinite(actualTime) && Number.isFinite(expectedTime)
      && Math.floor(actualTime / 1000) === Math.floor(expectedTime / 1000);
  };
  return value.id === event.id && value.summary === eventName && value.status !== 'cancelled'
    && sameSecond(record(value.start).dateTime, event.start)
    && sameSecond(record(value.end).dateTime, event.end)
    && record(record(value.extendedProperties).private).authProbe === event.id;
}

function checkHttp(status: number): void {
  if (status >= 200 && status < 300) return;
  const hint = status === 401 ? 'もう一度連携してください。'
    : status === 403 ? 'Calendar APIと同意した権限を確認してください。' : '時間を置いて再度試してください。';
  throw new ProbeFailure('calendar-http', `Googleカレンダーとの通信に失敗しました（HTTP ${status}）。${hint}`);
}

export function createProbe(deps: ProbeDependencies) {
  function configured(): ProbeResult | undefined {
    if (deps.missing.length === 0) return undefined;
    return { steps: [{ stage: '設定', status: 'error', code: 'missing-config',
      message: `config.local.jsonの設定が足りません：${deps.missing.join('、')}。保存後に再ビルドし、拡張機能を再読み込みしてください。` }] };
  }

  async function status(): Promise<ProbeResult> {
    const missing = configured();
    if (missing) return missing;
    try {
      const restored = await deps.auth.restore();
      const saved = await deps.read();
      if (!restored) return { steps: [{ stage: 'ログインの復元', status: 'ok', code: 'signed-out', message: '保存したログインはありません。' }] };
      const sameUid = saved?.namespace === deps.namespace && saved.uid === restored;
      return {
        steps: [{ stage: 'ログインの復元', status: sameUid ? 'ok' : 'error',
          code: sameUid ? 'restored' : 'uid-not-confirmed',
          message: sameUid ? '保存したログインから、前回と同じuidに戻りました。' : '前回とのuidの一致はまだ確認できません。' }],
        uidPrefix: restored.slice(0, 8), sameUid,
        workerChanged: !!saved && saved.workerId !== deps.workerId,
      };
    } catch {
      return { steps: [{ stage: 'ログインの復元', status: 'error', code: 'restore-failed',
        message: '保存したログインを確認できませんでした。設定と接続を確認してください。' }] };
    }
  }

  async function run(): Promise<ProbeResult> {
    const missing = configured();
    if (missing) return missing;
    const result: ProbeResult = { steps: [] };
    let stage = 'ログインの復元';
    const ok = (code: string, message: string) => result.steps.push({ stage, status: 'ok', code, message });
    try {
      await deps.auth.restore();
      ok('ready', '保存したログインの確認が終わりました。');
      stage = 'Googleとの連携';
      const token = await deps.auth.getToken();
      if (!token) throw new ProbeFailure('no-token', 'Googleとの連携が完了しませんでした。もう一度ボタンを押してください。');
      ok('authorized', 'Googleとの連携ができました。');
      stage = 'Firebaseへのログイン';
      const credential = deps.auth.credential(null, token);
      const uid = await deps.auth.signIn(credential);
      const previous = await deps.read();
      result.uidPrefix = uid.slice(0, 8);
      result.sameUid = previous?.namespace === deps.namespace && previous.uid === uid;
      result.workerChanged = !!previous && previous.workerId !== deps.workerId;
      ok('signed-in', result.sameUid ? '前回と同じuidでログインできました。' : 'Firebaseにログインできました。');

      stage = '専用カレンダー';
      let state: ProbeState;
      if (previous?.namespace === deps.namespace && previous.uid === uid) {
        state = previous;
        if (state.calendar.status === 'creating') {
          throw new ProbeFailure('calendar-recovery-required', '前回のカレンダー作成が終わったか不明です。二重に作らず停止しました。spikes/auth-probe.mdの復旧手順を確認してください。');
        }
      } else {
        const start = new Date(Math.floor(deps.now().getTime() / 1000) * 1000 + 24 * 60 * 60 * 1000);
        state = { namespace: deps.namespace, uid, workerId: deps.workerId,
          calendar: { status: 'creating' },
          event: { id: deps.newEventId(), start: start.toISOString(), end: new Date(start.getTime() + 5 * 60 * 1000).toISOString() } };
        // Calendar creation has no client-chosen ID. Never repeat an uncertain POST.
        await deps.write(state);
        let created;
        try {
          created = await deps.request('/calendars', token, { summary: calendarName, timeZone: 'Asia/Tokyo' });
        } catch (error) {
          if (error instanceof RequestNotSent) await deps.write(undefined);
          throw error;
        }
        // These responses reject creation. Other failures may hide a completed POST.
        if ([400, 401, 403].includes(created.status)) await deps.write(undefined);
        checkHttp(created.status);
        const id = record(created.data).id;
        if (typeof id !== 'string' || !id) throw new ProbeFailure('calendar-response', 'カレンダーの作成結果を確認できませんでした。再作成せず停止しました。');
        state.calendar = { status: 'ready', id };
      }
      state.workerId = deps.workerId;
      await deps.write(state);
      result.calendarName = calendarName;
      result.eventId = state.event.id;
      ok('calendar-ready', '専用のテスト用カレンダーを使います。');

      stage = 'テストの予定';
      if (state.calendar.status !== 'ready') throw new Error('Calendar not ready');
      const path = `/calendars/${encodeURIComponent(state.calendar.id)}/events`;
      const inserted = await deps.request(path, token, eventBody(state.event));
      if (inserted.status === 409) {
        const existing = await deps.request(`${path}/${state.event.id}`, token);
        checkHttp(existing.status);
        if (!matchesEvent(existing.data, state.event)) throw new ProbeFailure('event-mismatch', '同じ予定IDの内容が一致しません。重複なしとは判定できませんでした。');
        ok('already-exists', '同じ予定IDが既にあります（HTTP 409、内容も一致）。予定は増えていません。');
      } else {
        checkHttp(inserted.status);
        if (!matchesEvent(inserted.data, state.event)) throw new ProbeFailure('event-mismatch', '予定の作成結果が一致しません。同じ予定IDで再度確認してください。');
        ok('created', 'テストの予定を1つ作りました。もう一度押すと、同じ予定IDで試します。');
      }
    } catch (error) {
      // SDK/API errors may contain tokens, config, or response bodies. Never forward them.
      result.steps.push({ stage, status: 'error', code: error instanceof ProbeFailure ? error.code : 'probe-failed',
        message: error instanceof ProbeFailure ? error.message : `${stage}を完了できませんでした。設定・権限・接続を確認して、もう一度試してください。` });
    }
    return result;
  }

  return { run, status };
}
