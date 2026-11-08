import { useState, type FormEvent } from 'react';
import type { SessionContext } from '../../../../core/src/types';
import { dayInZone } from '../../shared/assignments/deadline-format';
import { useOperationMessage } from '../../shared/ui/operation-messages';

export function ContextEditor({ context, save }: { context: SessionContext; save: (context: SessionContext) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useOperationMessage();
  const localInput = (value: string | null) => value ? `${dayInZone(new Date(value), 'Asia/Tokyo')}T${new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))}` : '';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const date = (key: string) => form.get(key) ? `${String(form.get(key))}:00+09:00` : null;
    try { await save({ lastSessionAt: date('last'), nextSessionAt: date('next') }); setMessage('面談日時を保存しました。'); }
    catch { setMessage('面談日時を保存できませんでした。共有の許可と接続を確かめてください。'); }
    finally { setBusy(false); }
  }
  return <details className="session-editor"><summary>面談日時を変える</summary>
    <form onSubmit={event => { void submit(event); }}>
      <label>前回の面談（日本時間）<input name="last" type="datetime-local" defaultValue={localInput(context.lastSessionAt)} /></label>
      <label>次の面談（日本時間）<input name="next" type="datetime-local" defaultValue={localInput(context.nextSessionAt)} /></label>
      <p className="muted">日時が決まっていない欄は空にできます。</p>
      <button disabled={busy}>{busy ? '保存中…' : '面談日時を保存'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
