import { useId, useRef, useState, type InputHTMLAttributes } from 'react';
export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> { label: string; hint?: string; error?: string }
export function Field({ label, hint, error, id: suppliedId, 'aria-describedby': describedBy, ...props }: FieldProps) {
  const generated = useId(); const id = suppliedId ?? generated;
  return <div className={`td-field${error ? ' td-field-error' : ''}`}><label htmlFor={id}>{label}</label>
    <input {...props} id={id} aria-invalid={error ? true : props['aria-invalid']}
      aria-describedby={[describedBy, (error || hint) && `${id}-hint`].filter(Boolean).join(' ') || undefined} />
    {(error || hint) && <p id={`${id}-hint`} className="td-field-hint">{error || hint}</p>}</div>;
}
export interface TabsProps { label: string; items: { value: string; label: string }[]; value?: string; onChange?: (value: string) => void }
export function Tabs({ label, items, value, onChange }: TabsProps) {
  const [local, setLocal] = useState(items[0]?.value); const ref = useRef<HTMLDivElement>(null);
  const current = value ?? local;
  const select = (index: number) => { const item = items[index]; if (!item) return; setLocal(item.value); onChange?.(item.value); };
  return <div ref={ref} className="td-tabs" role="tablist" aria-label={label}>{items.map((item, index) =>
    <button key={item.value} type="button" className="td-tab" role="tab" aria-selected={current === item.value} tabIndex={current === item.value ? 0 : -1}
      onClick={() => select(index)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length :
          event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
        if (next === null) return; event.preventDefault(); select(next); ref.current?.querySelectorAll('button')[next]?.focus();
      }}>{item.label}</button>)}</div>;
}
