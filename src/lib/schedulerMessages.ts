/**
 * Staff-facing copy for scheduler cooldown rejections. The scheduler's own
 * `message` is written for API callers (it mentions `force=true`), so the UI
 * builds its hint from `wait_minutes` instead.
 */
export function discoveryCooldownHint(waitMinutes: number | null | undefined): string {
  const wait =
    typeof waitMinutes === 'number' && waitMinutes > 0
      ? `${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}`
      : 'a few minutes';
  return `A new Discovery run can start 10 minutes after the previous one. Try again in ${wait}.`;
}
