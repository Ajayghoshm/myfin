type Listener = (transactionIds: string[]) => void;

const listeners = new Set<Listener>();

/** Announces newly created real transactions so planned rows they match can be offered. */
export function announceCreatedTransactions(
  ids: Array<string | number | bigint>,
) {
  if (ids.length === 0) return;
  const list = ids.map(String);
  for (const listener of listeners) listener(list);
}

export function subscribeToCreatedTransactions(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
