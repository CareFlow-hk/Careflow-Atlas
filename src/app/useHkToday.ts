import { useEffect, useState } from 'react';
import { hkDay, msUntilNextHkDay } from '../domain/reminders';

/**
 * The Hong Kong calendar day, kept current while the page stays open.
 *
 * Reminders answer 今天 from a memo keyed on the workspace, so an app left open overnight
 * would keep counting from yesterday until something else changed. This waits until the
 * next Hong Kong midnight and asks again; a laptop that slept through it is caught when
 * the tab becomes visible, because a sleeping timer fires late.
 */
export function useHkToday(): string {
  const [today, setToday] = useState(() => hkDay());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const aim = () => { timer = setTimeout(() => { setToday(hkDay()); aim(); }, msUntilNextHkDay() + 1000); };
    const reread = () => { clearTimeout(timer); setToday(hkDay()); aim(); };
    aim();
    // Only a visible tab can be looked at, so coming back is the moment worth re-reading.
    const onVisible = () => { if (document.visibilityState === 'visible') reread(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  return today;
}
