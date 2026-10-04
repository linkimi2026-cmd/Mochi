import { createMechanicalAudio } from './mechanical-audio.mjs';

/** Decorative feedback only. Submission, drafts and durable preferences remain DSH-owned. */
export function installPaperFeedback(ctx, React, makeAudio = createMechanicalAudio, petPalettes = [], settings) {
  const soundScope = settings ?? ctx.settingsScope?.bind({ namespace: 'jxl-theme' });
  let soundEnabled = false;
  let soundPending = false;
  let soundError = '';
  let petPalette = 'caramel', petPending = false, petError = '';
  const soundListeners = new Set();
  const notifySound = () => soundListeners.forEach((listener) => listener());
  const audio = makeAudio(window, soundEnabled);
  ctx.effect(() => {
    audio.bind(document);
    const sync = () => {
      const snapshot = soundScope?.getSnapshot();
      soundEnabled = snapshot?.status === 'ready' && snapshot.value?.uiSound !== false;
      audio.setEnabled(soundEnabled);
      window.mochiRailDesktop?.setSoundEnabled?.(soundEnabled);
      const selected = snapshot?.value?.petPalette;
      if (snapshot?.status === 'ready') petPalette = petPalettes.some(p => p.id === selected) ? selected : 'caramel';
      if (document.documentElement?.dataset) document.documentElement.dataset.mochiPetPalette = petPalette;
      window.mochiRailDesktop?.setPetPalette?.(petPalette);
      notifySound();
    };
    const unsubscribe = soundScope?.subscribe(sync);
    sync();
    return () => { unsubscribe?.(); soundListeners.clear(); audio.dispose(); };
  }, 'jxl-theme: mechanical sound lifecycle');
  ctx.effect(() => {
    const timers = new Map();
    const submitting = new WeakSet();
    const frames = new Set();
    const feed = (card) => {
      if (!card || timers.has(card)) return;
      card.setAttribute('data-jxl-feeding', '');
      audio.play('feed');
      timers.set(card, setTimeout(() => {
        card.removeAttribute('data-jxl-feeding');
        timers.delete(card);
      }, 660));
    };
    // The native editor can batch its entire admission phase into one render.
    // A trusted submit gesture acknowledges intent, never delivery or success.
    const gesture = (event) => {
      if (!event.isTrusted || event.isComposing || event.repeat) return;
      const target = event.target;
      const card = target?.closest?.('[data-composer-card]');
      if (!card) return;
      if (event.type === 'click') {
        const button = target.closest('button');
        if (!button || button.disabled || !['发送消息', 'Send message'].includes(button.getAttribute('aria-label'))) return;
      } else {
        if (event.key !== 'Enter' || event.shiftKey || !target.matches('[data-composer-input]') || !target.textContent.trim()) return;
      }
      const frame = window.requestAnimationFrame(() => {
        frames.delete(frame);
        const current = card.isConnected ? card : [...document.querySelectorAll('[data-composer-card]')].find(node => node.getClientRects().length);
        feed(current);
      });
      frames.add(frame);
    };
    document.addEventListener?.('click', gesture, true);
    document.addEventListener?.('keydown', gesture, true);
    const observer = new MutationObserver((records) => {
      const inputs = new Map();
      for (const record of records) {
        if (!record.target.matches?.('[data-composer-input]')) continue;
        inputs.set(record.target, inputs.get(record.target) || ['adjudicating', 'submitting'].includes(record.oldValue));
      }
      for (const [input, ended] of inputs) {
        const active = ['adjudicating', 'submitting'].includes(input.getAttribute('data-phase'));
        const decorate = !submitting.has(input) && (active || ended);
        if (active) submitting.add(input);
        else submitting.delete(input);
        if (!decorate) continue;
        feed(input.closest('[data-composer-card]'));
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-phase'], attributeOldValue: true });
    return () => {
      observer.disconnect();
      document.removeEventListener?.('click', gesture, true);
      document.removeEventListener?.('keydown', gesture, true);
      for (const frame of frames) window.cancelAnimationFrame(frame);
      for (const [card, timer] of timers) {
        clearTimeout(timer);
        card.removeAttribute('data-jxl-feeding');
      }
      timers.clear();
    };
  }, 'jxl-theme: native submission paper feedback');

  ctx.inject(['theme', 'slots'], (scope) => {
    const syncWindows = (snapshot) => window.mochiRailDesktop?.setAppearance?.(snapshot.preference);
    scope.effect(() => {
      syncWindows(scope.theme.getTheme());
      return scope.on('theme/change', syncWindows);
    }, 'jxl-theme: native window appearance');
    const modes = ['light', 'system', 'dark'];
    const labels = { light: '白天', system: '跟随系统', dark: '夜间' };
    function ThemeDial({ wide }) {
      const [, refreshSound] = React.useState(() => 0);
      const audible = soundEnabled;
      React.useEffect(() => {
        const refresh = () => refreshSound((revision) => revision + 1);
        soundListeners.add(refresh);
        return () => soundListeners.delete(refresh);
      }, []);
      const [preference, setPreference] = React.useState(() => scope.theme.getTheme().preference);
      React.useEffect(() => scope.on('theme/change', (snapshot) => setPreference(snapshot.preference)), []);
      const change = (offset, wrap) => {
        const index = modes.indexOf(scope.theme.getTheme().preference);
        const next = wrap ? (index + offset + modes.length) % modes.length : Math.max(0, Math.min(2, index + offset));
        scope.theme.setTheme(modes[next]);
      };
      const label = labels[preference] || '跟随系统';
      const picker = petPalettes.length ? React.createElement('div', {className:'jxl-pet-colors',role:'group','aria-label':'Mochi 配色'},
        ...petPalettes.map(p => React.createElement('button', {
          key:p.id,type:'button','aria-pressed':petPalette===p.id,'aria-label':p.label,
          disabled:petPending || !soundScope?.getSnapshot().writable,
          onClick:async()=>{
            if(petPending || petPalette===p.id)return;
            petPending=true;petError='';notifySound();
            try{await soundScope.set('petPalette',p.id);}
            catch{petError='配色未保存，请重试';}
            finally{petPending=false;notifySound();}
          },
        },React.createElement('svg',{viewBox:'0 0 24 24','aria-hidden':true},
          React.createElement('circle',{cx:12,cy:12,r:11,fill:p.body}),
          React.createElement('rect',{x:7,y:8,width:3,height:7,rx:1.5,fill:p.eyes}),
          React.createElement('rect',{x:14,y:8,width:3,height:7,rx:1.5,fill:p.eyes})),p.label,petPalette===p.id?' ✓':'')),
        petError?React.createElement('span',{className:'jxl-pet-colors__error',role:'alert'},petError):null):null;
      return React.createElement('div', { className: 'jxl-theme-control jxl-settings-appearance', 'data-wide': true },
        React.createElement('div', { className: 'jxl-setting-label' }, '外观', React.createElement('p', null, '选择白天、跟随系统或夜间')),
        React.createElement('button', {
          type: 'button', className: 'jxl-theme-dial', 'data-preference': preference,
          'aria-label': `外观：${label}，点击切换`, title: `外观：${label}（左右方向键切换）`,
          onClick: () => change(1, true),
          onKeyDown: (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') scope.theme.setTheme('light');
            else if (event.key === 'End') scope.theme.setTheme('dark');
            else change(event.key === 'ArrowLeft' ? -1 : 1, false);
          },
        },
        React.createElement('span', { className: 'jxl-theme-dial__marks', 'aria-hidden': true }, '☀ ◐ ☾'),
        React.createElement('span', { className: 'jxl-theme-dial__seat', 'aria-hidden': true }),
        React.createElement('span', { className: 'jxl-theme-dial__lever', 'aria-hidden': true })),
        React.createElement('span', { 'aria-live': 'polite' }, label),
        picker ? React.createElement('div', { className: 'jxl-setting-label jxl-pet-label' }, 'Mochi 配色', React.createElement('p', null, '只改变 Mochi，自动保存到这台电脑')) : null,
        picker,
        React.createElement('div', { className: 'jxl-setting-label' }, '界面音效', React.createElement('p', null, '发送和拨杆操作的轻声反馈')),
        React.createElement('button', {
          type: 'button', className: 'jxl-sound-toggle', 'aria-pressed': audible,
          'aria-label': audible ? '关闭界面音效' : '开启界面音效',
          title: soundError || (audible ? '界面音效：开' : '界面音效：关'),
          disabled: soundPending || !soundScope?.getSnapshot().writable,
          'aria-busy': soundPending,
          onClick: async () => {
            if (soundPending) return;
            const next = !soundEnabled;
            soundPending = true; soundError = ''; notifySound();
            // Unlock during this gesture; a failed write restores the Host preference.
            audio.setEnabled(next);
            if (next) audio.arm();
            try {
              await soundScope.set('uiSound', next);
              if (soundEnabled) audio.play('detent');
            } catch {
              soundError = '音效偏好未保存，请重试';
            } finally {
              soundPending = false;
              audio.setEnabled(soundEnabled);
              notifySound();
            }
          },
        }, React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          React.createElement('path', { d: 'M11 5 6 9H3v6h3l5 4z' }),
          React.createElement('path', { d: audible ? 'M15 8c3 2 3 6 0 8M18 5c5 4 5 10 0 14' : 'm16 9 6 6m0-6-6 6' }))));
    }
    scope.slots.inject('settings.general.item', () => scope.slots.register({
      name: 'settings.general.item', id: 'appearance', priority: -10, order: 10,
    }, ThemeDial));
  });
}
