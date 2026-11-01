// Ids to send to the API: every previewed change except the ones the user excluded
export function selectedIds(
  changes: Array<{ transaction_id: string }>,
  excluded: Set<string>,
): string[] {
  return changes
    .map((change) => change.transaction_id)
    .filter((id) => !excluded.has(id));
}
