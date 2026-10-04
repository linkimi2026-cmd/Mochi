import React from 'react';
import { guideSteps, guideGeometry, normalizeProgress, STEP_IDS, GUIDE_VERSION } from './steps.mjs';
import { locateGuideTarget, TARGET_HINTS } from './navigation.mjs';
import { SidebarAction, sidebarIcons } from './sidebar-action.mjs';
const h = React.createElement;
export const inject = ['slots', 'configForms'];

/** Small original line drawings explain actions; they do not impersonate live UI. */
function Sketch({ kind }) {
  const paths = kind === 'input' ? ['M10 12h120v50H10z', 'M20 24h64M20 34h80M20 44h46', 'M112 48l6-6 6 6M118 42v13']
    : kind === 'pair' ? ['M12 14h42v40H12zM94 14h42v40H94z', 'M64 27h20M79 22l5 5-5 5M84 41H64M69 36l-5 5 5 5', 'M23 61h20M105 61h20']
      : ['M24 10h88v54H24z', 'M36 25h64M36 35h54M36 45h40', 'M112 54l12-6v16l-12-6'];
  return h('svg', { viewBox: '0 0 148 72', className: 'mochi-guide-sketch', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
    ...paths.map((d, index) => h('path', { key: index, d })));
}

export function apply(ctx) {
  const form = ctx.configForms.get('mochi-onboarding');
  let opened = false, step = 'identity', busy = false, message = '', profile = null, profileFailed = false;
  let profileGate = false, coordinator = null, firstStarted = false, disposed = false, compact = false, anchor = null, required = true, modalVisible = false;
  let campus = window.mochiCampusIdentitySnapshot ?? { status: 'unknown' };
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  const progress = () => normalizeProgress(form.getSnapshot());
  const useState = () => { const [, force] = React.useReducer(value => value + 1, 0); React.useEffect(() => { listeners.add(force); return () => listeners.delete(force); }, []); };
  const hasModal = () => [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some(node => node.getClientRects().length > 0);
  // Observe after DOM commit; a React render still sees the previous modal DOM.
  const readyForGuide = () => profileGate && !modalVisible;
  const first = () => {
    if (!coordinator) return;
    const state = progress();
    if (state.ready && state.status !== 'new') { coordinator.complete(); return; }
    if (!firstStarted && state.ready && readyForGuide()) {
      firstStarted = true; required = true; step = state.step; anchor = document.activeElement; opened = true; notify();
    }
  };
  const readProfile = async () => {
    try {
      const response = await fetch('/api/mochi-profile', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Profile unavailable');
      const value = await response.json();
      if (disposed) return;
      if (!['teacher', 'classroom'].includes(value.role)) throw new Error('Profile role unavailable');
      profile = value; profileFailed = false;
      profileGate = value.configured === true || value.setupDismissed === true || document.documentElement.dataset.mochiUserProfilePromptDone === 'true';
    } catch { if (disposed) return; profileFailed = true; profileGate = true; }
    notify(); first();
  };
  const save = async (nextStep, status) => {
    const state = progress();
    if (!state.persistent) throw new Error('指引进度暂时不能保存，请检查本机连接；可以先继续使用。');
    const accepted = await form.mutate([{ op: 'set', path: ['version'], value: GUIDE_VERSION }, { op: 'set', path: ['step'], value: nextStep }, { op: 'set', path: ['status'], value: status }]);
    if (!accepted) throw new Error('指引进度没有保存成功，请稍后再试。');
  };
  const act = async action => {
    if (busy) return;
    busy = true; message = ''; notify();
    try { await action(); } catch (error) { message = error.message; } finally { busy = false; notify(); }
  };
  const close = () => {
    opened = false; coordinator?.complete();
    const target = anchor?.isConnected && anchor.getClientRects().length && !anchor.closest('[hidden],[inert]') ? anchor : locateGuideTarget(document, 'composer');
    target?.focus?.(); notify();
  };
  const advance = direction => act(async () => {
    const index = STEP_IDS.indexOf(step), next = STEP_IDS[Math.max(0, index + direction)];
    if (!next) { await save(step, 'complete'); close(); return; }
    await save(next, required ? 'new' : 'complete'); step = next; message = ''; compact = false; notify();
  });
  const reopen = event => {
    const state = progress();
    anchor = event?.currentTarget ?? document.activeElement; required = state.status !== 'complete'; step = required ? state.step : STEP_IDS[0]; compact = false; opened = true; message = ''; notify();
  };
  const visibleButton = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && button.getClientRects().length && !button.disabled && !button.closest('[hidden],[inert]'));
  const waitFor = async read => {
    const deadline = Date.now() + 1500;
    do { const value = read(); if (value) return value; await new Promise(done => setTimeout(done, 50)); } while (!disposed && Date.now() < deadline);
    return null;
  };
  let marked = null, markTimer;
  const highlight = target => {
    marked?.removeAttribute('data-mochi-guide-target'); clearTimeout(markTimer); marked = target;
    target.setAttribute('data-mochi-guide-target', 'true'); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); target.focus?.({ preventScroll: true });
    markTimer = setTimeout(() => { marked?.removeAttribute('data-mochi-guide-target'); marked = null; }, 4500);
  };
  const navigate = action => act(async () => {
    if (action === 'identity') {
      if (!locateGuideTarget(document, 'mail')) throw new Error(TARGET_HINTS.mail);
      window.dispatchEvent(new CustomEvent('mochi-open-user-profile'));
      const panel = await waitFor(() => document.querySelector('[role="dialog"][aria-label="设备与连接"]'));
      if (!panel) throw new Error('称呼入口还不可用。请打开“小信箱 → 设备与连接”，或检查身份服务。');
      compact = true; return;
    }
    if (action === 'memory') {
      const event = new CustomEvent('mochi-open-memory', { cancelable: true }); window.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error('记忆回看入口还不可用；可在对话中询问“你记住了什么”，查看实际保存的记忆。');
      compact = true; return;
    }
    const target = locateGuideTarget(document, action);
    if (!target) throw new Error(TARGET_HINTS[action] ?? '当前入口还不可用，请先核对设置。');
    compact = true;
    if (['composer', 'voice', 'voicechat', 'camera'].includes(action)) { highlight(target); message = '已标出真实入口；由你点击或输入，指南不会开始录音、拍照或发送。'; return; }
    if (action === 'campus' && target.getAttribute('aria-expanded') === 'true') { highlight(target); return; }
    target.click();
    if (action === 'account') {
      await waitFor(() => document.querySelector('[role="dialog"] .jxl-campus-account'));
      const account = document.querySelector('[role="dialog"] .jxl-campus-account');
      if (!account) {
        visibleButton('通用')?.click();
        const found = await waitFor(() => document.querySelector('[role="dialog"] .jxl-campus-account'));
        if (!found) throw new Error(TARGET_HINTS.account);
      }
      const button = document.querySelector('[role="dialog"] .jxl-campus-account button');
      if (!button || !button.getClientRects().length) throw new Error(TARGET_HINTS.account);
      highlight(button); message = '已标出原校园账号按钮；请在实际页面登录。';
    }
  });
  function Entry({ wide }) { useState(); return h(SidebarAction, { wide, label: '指引', description: '新手指引', icon: sidebarIcons.guide, onClick: reopen }); }
  function FirstRun({ complete, openSection }) {
    React.useEffect(() => { coordinator = { complete, openSection }; first(); return () => { if (coordinator?.complete === complete) coordinator = null; }; }, [complete, openSection]);
    return null;
  }
  function Card() {
    useState();
    const ref = React.useRef(null), [geometry, setGeometry] = React.useState(() => guideGeometry({ width: innerWidth, height: innerHeight }));
    React.useLayoutEffect(() => {
      if (!opened) return;
      const place = () => {
        const composer = [...document.querySelectorAll('[data-conversation-content] [data-composer-card]')].find(node => node.getClientRects().length);
        const header = document.querySelector('[data-slot="conversation.header"]');
        setGeometry(guideGeometry({ width: innerWidth, height: innerHeight, composerTop: composer?.getBoundingClientRect().top, headerBottom: Math.max(64, header?.getBoundingClientRect().bottom ?? 64) }));
      };
      place(); const resize = new ResizeObserver(place);
      const composer = [...document.querySelectorAll('[data-conversation-content] [data-composer-card]')].find(node => node.getClientRects().length); if (composer) resize.observe(composer);
      window.addEventListener('resize', place); return () => { resize.disconnect(); window.removeEventListener('resize', place); };
    }, [opened, step, compact, modalVisible]);
    if (!opened || !readyForGuide()) return null;
    const steps = guideSteps(profile?.role), index = STEP_IDS.indexOf(step), current = steps[index];
    return h('aside', { ref, role: 'region', className: 'mochi-guide', 'aria-label': 'Mochi 新手指引', hidden: geometry.hidden, style: { top: geometry.top, right: geometry.right, width: geometry.width, maxHeight: geometry.maxHeight } },
      h('header', null, h('span', null, `${index + 1} / ${steps.length} · ${required ? '首次使用，逐步认识 Mochi' : '重新看看'}`), !required && h('button', { type: 'button', 'aria-label': '关闭重看指引', disabled: busy, onClick: close }, '关闭')),
      h('h2', null, current.title),
      compact ? h('button', { type: 'button', onClick: () => { compact = false; notify(); } }, '展开这一步') : h(React.Fragment, null,
        h(Sketch, { kind: current.sketch }), h('p', null, current.text), h('p', { className: 'mochi-guide-note' }, current.note),
        step === 'identity' && h('p', { role: 'status' }, profileFailed ? '称呼服务尚未连接，身份和称呼状态未确认。' : profile?.configured ? '称呼已保存；本机身份与校园认证仍按各自真实状态核对。' : '称呼还没填写，可以先设置，也可以稍后补。'),
        step === 'account' && h('p', { role: 'status' }, campus.status === 'authenticated' ? '原校园账号页面报告：账号已登录。' : campus.status === 'unauthenticated' ? '原校园账号页面报告：尚未登录。' : '校园账号状态尚未确认，请在原页面查看。'),
        h('div', { className: 'mochi-guide-actions' }, ...current.actions.map(([action, label]) => h('button', { key: action, type: 'button', disabled: busy, onClick: () => navigate(action) }, label)))),
      message && h('p', { role: 'status', className: 'mochi-guide-note' }, message),
      h('footer', null, h('button', { type: 'button', disabled: busy || index === 0, onClick: () => advance(-1) }, '上一步'),
        h('button', { type: 'button', disabled: busy, onClick: () => advance(1) }, index === steps.length - 1 ? '完成指引' : '我了解了，下一步')));
  }
  const style = document.createElement('style');
  style.textContent = '.mochi-guide{position:fixed;z-index:35;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:14px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32);padding:16px;box-shadow:0 8px 24px #0001;font-size:13px;line-height:1.6}.mochi-guide header,.mochi-guide footer,.mochi-guide-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mochi-guide header{justify-content:space-between;font-size:11px}.mochi-guide h2{font-size:17px;line-height:1.4;margin:12px 0 6px}.mochi-guide p{margin:9px 0}.mochi-guide-note{color:var(--dsw-alias-label-secondary,#746c60);font-size:12px}.mochi-guide-sketch{width:148px;height:72px;display:block;margin:10px auto;color:var(--dsw-alias-label-secondary,#746c60)}.mochi-guide button{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:8px;padding:5px 9px;background:var(--dsw-alias-bg-base,#fffefa);cursor:pointer}.mochi-guide button:active{transform:translateY(1px)}.mochi-guide button:disabled{opacity:.5;cursor:default}.mochi-guide footer{position:sticky;bottom:-16px;margin:12px -16px -16px;padding:10px 16px;background:var(--dsw-alias-bg-base,#fffefa);border-top:1px solid var(--dsw-alias-border-l2,#d8d3c7);justify-content:space-between}.mochi-guide :focus-visible{outline:2px solid currentColor;outline-offset:2px}[data-mochi-guide-target="true"]{outline:2px solid var(--dsw-alias-label-primary,#403b32)!important;outline-offset:3px!important}@media(prefers-reduced-motion:reduce){.mochi-guide button:active{transform:none}}';
  style.textContent += '.mochi-guide::before{content:"";position:absolute;right:0;top:0;width:26px;height:26px;pointer-events:none;background:linear-gradient(225deg,var(--dsw-alias-bg-layer-2,#fffefa) 47%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 53%)}.mochi-guide header{border-bottom:1px dashed var(--dsw-alias-border-l2,#d8d3c7);padding-bottom:10px;padding-right:10px}.mochi-guide h2{font-family:var(--dsw-font-serif,serif)}.mochi-guide-entry{flex-shrink:0;white-space:nowrap;font:inherit;font-size:12px;padding:5px 6px;border-radius:7px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);cursor:pointer}';
  document.head.append(style);
  const offForm = form.subscribe(() => { notify(); first(); });
  const dismissed = () => { profileGate = true; void readProfile(); first(); };
  const updated = () => { void readProfile(); };
  const auth = () => { campus = window.mochiCampusIdentitySnapshot ?? { status: 'unknown' }; notify(); };
  const escape = event => {
    if (event.key !== 'Escape' || !opened || hasModal()) return;
    event.preventDefault();
    if (!required) close();
    else { message = '首次指引会保留在这里。请按步骤继续；外部服务不可用时，核对说明后也能进入下一步。'; compact = false; notify(); }
  };
  modalVisible = hasModal();
  const surfaceChanged = () => {
    const modal = hasModal();
    if (modal !== modalVisible) { modalVisible = modal; notify(); }
    first();
  };
  const transitionFinished = event => {
    if (event.target.closest?.('[data-shell-overlay],dialog,[role="dialog"]')) surfaceChanged();
  };
  const mutation = new MutationObserver(surfaceChanged);
  mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'inert', 'aria-modal', 'class', 'style'] });
  window.addEventListener('mochi-user-profile-dismissed', dismissed); window.addEventListener('mochi-user-profile-updated', updated);
  window.addEventListener('campus:auth-state', auth); window.addEventListener('mochi-open-onboarding', reopen); document.addEventListener('keydown', escape);
  window.addEventListener('focus', surfaceChanged); document.addEventListener('visibilitychange', surfaceChanged);
  document.addEventListener('transitionend', transitionFinished); document.addEventListener('animationend', transitionFinished); document.addEventListener('close', surfaceChanged, true);
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({ name: 'settings.onboarding', id: 'mochi-guide', order: 100 }, FirstRun));
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'mochi-guide-entry', order: 90 }, Entry));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'mochi-guide-card', order: 90 }, Card));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'mochi-guide-reopen', order: 100 }, Entry));
  void readProfile();
  ctx.on('dispose', () => {
    disposed = true; offForm(); mutation.disconnect(); clearTimeout(markTimer); marked?.removeAttribute('data-mochi-guide-target'); style.remove(); listeners.clear();
    window.removeEventListener('mochi-user-profile-dismissed', dismissed); window.removeEventListener('mochi-user-profile-updated', updated);
    window.removeEventListener('campus:auth-state', auth); window.removeEventListener('mochi-open-onboarding', reopen); document.removeEventListener('keydown', escape);
    window.removeEventListener('focus', surfaceChanged); document.removeEventListener('visibilitychange', surfaceChanged);
    document.removeEventListener('transitionend', transitionFinished); document.removeEventListener('animationend', transitionFinished); document.removeEventListener('close', surfaceChanged, true);
  });
}
