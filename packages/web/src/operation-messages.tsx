import { createContext, useContext, useId, useState, type ReactNode } from 'react';

const Messages = createContext<{
  current: { owner: string; text: string };
  publish: (owner: string, text: string) => void;
} | null>(null);

export function OperationMessages({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState({ owner: '', text: '' });
  return <Messages value={{ current, publish: (owner, text) => setCurrent({ owner, text }) }}>{children}</Messages>;
}

// Each control keeps its notice nearby; starting another operation clears it across the page.
export function useOperationMessage(): [string, (text: string) => void] {
  const shared = useContext(Messages);
  const owner = useId();
  const [local, setLocal] = useState('');
  return shared ? [shared.current.owner === owner ? shared.current.text : '', text => shared.publish(owner, text)] : [local, setLocal];
}
