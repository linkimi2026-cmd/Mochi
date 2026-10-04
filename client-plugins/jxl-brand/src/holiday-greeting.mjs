import lunar from './vendor/lunar/lunar.cjs';
import {isWarmGreeting} from '../../../plugins/mochi-user-profile/greeting-policy.mjs';

const greetings = new Map([
  ['春节', '新年好，愿新岁平安顺遂'],
  ['除夕', '除夕好，愿今夜团圆温暖'],
  ['元宵节', '元宵喜乐，愿灯火伴你团圆'],
  ['端午节', '端午安康，愿日子清和自在'],
  ['中秋节', '中秋快乐，愿人月两团圆'],
  ['元旦节', '新年好，愿今天是美好的开始'],
  ['劳动节', '劳动节快乐，辛苦了，歇一歇吧'],
  ['国庆节', '国庆快乐，愿你自在，心有晴光'],
  ['教师节', '教师节快乐，谢谢你的用心陪伴'],
  ['清明', '清明时节，愿思念有寄，春日安好'],
]);

export function holidayGreeting(date = new Date()) {
  if (!Number.isFinite(date.getTime())) return '你好，我是 Mochi';
  const solar = lunar.Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const calendar = solar.getLunar();
  const festivals = [...calendar.getFestivals(), ...solar.getFestivals(), calendar.getJieQi()];
  for (const festival of festivals) if (greetings.has(festival)) return greetings.get(festival);
  return '你好，我是 Mochi';
}

// One wake-up at local midnight; focus/visibility also cover sleep and clock changes.
export function installHolidayGreeting(locale, dictionary, environment = window, options = {}) {
  let disposeDictionary;
  let timer;
  let current;
  let disposed = false;
  let polling;
  let generation = 0;
  let inFlight = false;
  let reload = false;
  let polls = 0;
  const setHeadline = headline => {
    if (headline === current) return;
    disposeDictionary?.();
    disposeDictionary = locale.register('conversation', 'zh-JXL', { ...dictionary, 'hero.headline': headline });
    current = headline;
  };
  const load = async () => {
    if (inFlight) { reload = true; return; }
    if (disposed || !options.isHome?.() || environment.navigator?.onLine === false || !environment.fetch) return;
    inFlight = true; const ticket = generation;
    try {
      const response = await environment.fetch('/api/mochi-holiday', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(2500) });
      if (!response.ok) return; const value = await response.json();
      if (disposed || ticket !== generation || !options.isHome()) return;
      if (isWarmGreeting(value.greeting)) setHeadline(value.greeting);
      if (value.status === 'pending' && polls++ < 3) polling = environment.setTimeout(load, 10000);
    } catch { /* Static headline is already visible; no error toast or startup wait. */ }
    finally { inFlight = false; if (reload) { reload = false; void load(); } }
  };
  const refresh = () => {
    if (disposed) return;
    const now = new Date();
    const headline = holidayGreeting(now);
    setHeadline(headline);
    generation++; polls = 0; environment.clearTimeout(polling);
    void load();
    environment.clearTimeout(timer);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = environment.setTimeout(refresh, tomorrow.getTime() - now.getTime() + 100);
  };
  const disposeHome = options.subscribe?.(() => { if (options.isHome()) refresh(); else { generation++; environment.clearTimeout(polling); } });
  refresh();
  environment.addEventListener('focus', refresh);
  environment.addEventListener('mochi-user-profile-updated', refresh);
  environment.addEventListener('mochi-memory-updated', refresh);
  environment.document.addEventListener('visibilitychange', refresh);
  return () => {
    disposed = true;
    environment.clearTimeout(timer);
    environment.clearTimeout(polling);
    disposeHome?.();
    environment.removeEventListener('focus', refresh);
    environment.removeEventListener('mochi-user-profile-updated', refresh);
    environment.removeEventListener('mochi-memory-updated', refresh);
    environment.document.removeEventListener('visibilitychange', refresh);
    disposeDictionary?.();
  };
}

export function subscribeHolidayHome(ctx, listener) {
  let currentId, disposeSession;
  const changed = () => {
    const id = ctx.sidebarRight?.mounted ? ctx.sidebarRight.mounted.getSnapshot() : ctx.sessions.list.getSnapshot().current;
    if (id !== currentId) {
      disposeSession?.(); currentId = id;
      disposeSession = id === undefined ? undefined : ctx.sessions.binding(id)?.session.subscribe(listener);
    }
    listener();
  };
  const disposeList = ctx.sessions.list.subscribe(changed);
  const disposeMounted = ctx.sidebarRight?.mounted?.subscribe(changed);
  changed();
  return () => { disposeList(); disposeMounted?.(); disposeSession?.(); };
}
