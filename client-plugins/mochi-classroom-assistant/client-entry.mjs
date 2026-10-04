import React from 'react';
import { ListeningController } from '../../plugins/mochi-classroom-assistant/listening.mjs';
import { capturePcm } from './recorder.mjs';
import { ListeningEntryControl } from '../mochi-voice-chat/entry-controls.mjs';

const BASE = '/api/mochi-classroom';
export const inject = ['slots'];
const labels = { stopped: '监听未开启', preparing: '准备本地识别', listening: '后台监听中', paused: '后台监听已暂停', error: '监听需要处理' };
export function apply(ctx) {
  let disposed = false, timer, host = null, status = { state: 'stopped' }, open = false, selected = null, startup = null, pendingLetterId = null, manualListening = false;
  const drafts = new Map();
  const reasons = new Set(), listeners = new Set(), proxy = { data: { active: null } };
  const notify = () => { for (const listener of listeners) listener(); };
  const update = next => { host = next; proxy.data.active = host.active; if (!host.settings.autoStartListening && !manualListening) reasons.add('startup-disabled'); else reasons.delete('startup-disabled'); if (pendingLetterId && host.letters.some(letter => letter.id === pendingLetterId)) { selected = pendingLetterId; pendingLetterId = null; open = true; } notify(); };
  const request = async (path, input, signal) => {
    const response = await fetch(BASE + path, { credentials: 'same-origin', signal, ...(input === undefined ? {} : { method: 'POST', headers: { 'content-type': input instanceof Uint8Array ? 'audio/wav' : 'application/json' }, body: input instanceof Uint8Array ? input : JSON.stringify(input) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `课堂助手请求失败 (${response.status})`);
    return value;
  };
  const read = async signal => { const next = await request('/state', undefined, signal); update(next); return next; };
  const selectedProvider = next => next.speech.providers.find(item => item.id === next.speech.selection.providerId);
  const controller = new ListeningController({ store: proxy, capture: (onAudio, signal, onFailure) => capturePcm(onAudio, signal, globalThis, onFailure),
    prepare: async signal => {
      const next = await read(signal), provider = selectedProvider(next);
      if (provider?.location !== 'host-local') throw new Error('请先在语音设置选择本地识别。');
      if (provider.preparation.phase === 'standby') await request('/prepare', {}, signal);
      else if (provider.preparation.phase !== 'ready') throw new Error('请先准备本地识别模型，再开启监听。');
    },
    transcribe: (audio, signal) => request('/transcribe', audio, signal),
    onState: next => { status = next; notify(); if (next.state === 'listening') void window.mochiClassroomDesktop?.listeningReady?.(); window.dispatchEvent(new CustomEvent('mochi-classroom-listening-state', { detail: { ...status, pauseReasons: [...reasons] } })); },
    handleResult: result => {
      update(result.state);
      if (result.intent.kind === 'wake') { void window.mochiClassroomDesktop?.wake?.(); window.dispatchEvent(new CustomEvent('mochi-classroom-wake')); }
      if (result.letter) showLetter(result.letter);
      if (result.lessonLetter) showLetter(result.lessonLetter);
    },
  });
  const showLetter = letter => { selected = letter.id; open = true; notify(); void window.mochiClassroomDesktop?.letterReady?.({ id: letter.id, title: letter.title, body: letter.body, endedAt: letter.endedAt }); window.dispatchEvent(new CustomEvent('mochi-classroom-letter', { detail: letter })); };
  const pause = async (reason = 'manual') => { if (reason === 'manual') manualListening = false; reasons.add(reason); await controller.pause(); notify(); };
  const resume = async (reason = 'manual') => {
    if (reason === 'manual') { manualListening = true; reasons.delete('startup-disabled'); }
    reasons.delete(reason); notify();
    if (!disposed && !reasons.size) await controller.resume();
  };
  const busy = event => { const { reason, busy } = event.detail ?? {}; if (typeof reason !== 'string' || reason.length > 80 || typeof busy !== 'boolean') return; void (busy ? pause(reason) : resume(reason)); };
  const api = { pause, resume, snapshot: () => ({ ...status, pauseReasons: [...reasons], recordingHomework: !!host?.active, recordingLesson: !!host?.lessonActive }), open: () => { open = true; notify(); } };
  const useSnapshot = () => { const [, rerender] = React.useReducer(n => n + 1, 0); React.useEffect(() => { listeners.add(rerender); return () => listeners.delete(rerender); }, []); };
  const h = React.createElement;
  const run = operation => void Promise.resolve().then(operation).catch(error => { status = { ...status, error: error.message }; notify(); });
  function Entry({wide}) {
    useSnapshot(); if (!host) return null;
    const label=`${host.lessonActive ? '上课记录中 · ' : host.active ? '正在记录作业 · ' : ''}${labels[status.state] || status.state}`;
    return h(ListeningEntryControl,{wide,state:status.state,label,description:status.error || `课堂助手：${label}；本地监听、作业记录与暂停`,onClick:()=>api.open()});
  }
  function LetterEditor({ letter }) {
    const [body, setBody] = React.useState(drafts.get(letter.id) ?? letter.body), [saving, setSaving] = React.useState(false);
    return h('section', { className: 'mochi-classroom-paper' }, h('h3', null, letter.title), h('p', null, letter.kind === 'lesson' ? '本地从本节课识别原文选出要点，可编辑并展开核对来源。保存仅保留在本机。' : '以下为真实识别原文，可纠正错字。保存仅保留在本机。'),
      h('textarea', { value: body, onChange: event => { const next = event.target.value; drafts.set(letter.id, next); setBody(next); }, 'aria-label': letter.kind === 'lesson' ? '课堂重点信件正文' : '作业信件正文', maxLength: 100000, rows: 12 }),
      h('button', { type: 'button', disabled: saving, onClick: () => { setSaving(true); run(async () => { try { const result = await request('/edit', { id: letter.id, body }); update(result.state); drafts.delete(letter.id); } finally { setSaving(false); } }); } }, saving ? '保存中…' : '保存修改'),
      letter.kind === 'lesson' && h('details', null, h('summary', null, '查看重点来源与本节课原文'),
        h('p', null, '时间为本机收到识别文字的时间，不能据此判定说话人。'),
        ...letter.notes.map(note => h('details', { key: note.id }, h('summary', null, note.text),
          ...note.sourceRefs.map((ref, index) => { const segment = letter.segments.find(item => item.id === ref.segmentId); return h('p', { key: index }, `${new Date(ref.at).toLocaleTimeString()} · ${segment?.text ?? ''}`); }))),
        h('details', null, h('summary', null, `本节课全部识别原文（${letter.segments.length}段）`),
          ...letter.segments.map(segment => h('p', { key: segment.id }, `${new Date(segment.at).toLocaleTimeString()} · ${segment.text}`)))));
  }
  function Panel() {
    useSnapshot(); if (!host || !open) return null;
    const provider = selectedProvider(host), ready = ['ready', 'standby'].includes(provider?.preparation.phase);
    const letter = host.letters.find(item => item.id === selected);
    return h('div', { className: 'mochi-classroom-backdrop', onClick: event => { if (event.target === event.currentTarget) { open = false; notify(); } } },
      h('section', { className: 'mochi-classroom-panel', role: 'dialog', 'aria-modal': true, 'aria-label': '课堂助手' },
        h('header', null, h('h2', null, '课堂助手'), h('button', { type: 'button', onClick: () => { open = false; notify(); } }, '关闭')),
        h('p', { role: 'status' }, `${labels[status.state]}${host.lessonActive ? ' · 正在记录本节课' : ''}${host.active ? ' · 正在记录作业原文' : ''}`),
        status.error && h('p', { role: 'alert' }, status.error),
        h('p', null, '说“开始上课”记录本节课，说“下课”生成重点摘录信；说“把猫叫出来”唤醒 Mochi；提到“作业”开始记录，说“结束作业记录”生成信件。麦克风持续使用时保持可见状态，识别只在本机进行。'),
        h('div', { className: 'mochi-classroom-actions' },
          h('button', { type: 'button', disabled: !ready || status.state === 'preparing', onClick: () => run(() => status.state === 'listening' ? pause('manual') : resume('manual')) }, status.state === 'listening' ? '暂停监听' : '开启监听'),
          !ready && h('button', { type: 'button', onClick: () => run(async () => { await request('/prepare', {}); await read(); }) }, '准备本地识别模型'),
          h('button', { type: 'button', onClick: () => run(async () => { const result = await request(host.lessonActive ? '/lesson/finish' : '/lesson/begin', {}); update(result.state ?? result); if (result.letter) showLetter(result.letter); }) }, host.lessonActive ? '下课，整理重点' : '开始上课'),
          host.active && h('button', { type: 'button', onClick: () => run(async () => { const result = await request('/finish', {}); update(result.state); if (result.letter) showLetter(result.letter); }) }, '结束记录，生成信件')),
        h('label', null, h('input', { type: 'checkbox', checked: !!host.settings.autoStartListening && (!startup?.supported || startup.enabled), disabled: startup?.needsApproval === true, onChange: event => {
          const enabled = event.target.checked;
          run(async () => {
            const native = window.mochiClassroomDesktop, before = startup;
            if (native?.setStartup) {
              startup = await native.setStartup(enabled); notify();
              if (startup.supported && (startup.enabled !== enabled || startup.needsApproval)) throw new Error('系统开机启动尚未生效，请在系统设置完成授权。');
            }
            try { manualListening = false; update(await request('/configure', { autoStartListening: enabled })); }
            catch (error) { if (before?.supported) startup = await native.setStartup(before.enabled); throw error; }
            if (enabled) await resume('startup-disabled'); else await pause('startup-disabled');
          });
        } }), startup?.supported ? '开机后自动监听' : '应用启动后自动监听'),
        startup?.needsApproval && h('p', null, '系统开机启动等待授权，请到系统登录项设置允许 Mochi。'),
        provider && h('p', null, `本地模型状态：${({ unprepared: '尚未准备', ready: '就绪', standby: '待机', checking: '检查中', downloading: '下载中', loading: '加载中', waking: '唤醒中', cancelling: '取消中', cancelled: '已取消', failed: '准备失败' })[provider.preparation.phase] || provider.preparation.phase}`),
        reasons.size > 0 && h('p', null, `暂停原因：${[...reasons].map(reason => ({ manual: '手动暂停', 'official-voice-input': '语音输入正在使用麦克风', 'startup-disabled': '自动监听已关闭', tts: '正在朗读' })[reason] || reason).join('、')}`),
        h('h3', null, '本机课堂信件'), host.letters.length ? h('div', null, ...host.letters.slice().reverse().map(item => h('button', { key: item.id, type: 'button', onClick: () => { selected = item.id; notify(); } }, `${item.title} · ${new Date(item.endedAt).toLocaleString()}`))) : h('p', null, '还没有课堂信件。'),
        letter && h(LetterEditor, { key: letter.id, letter })));
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'mochi-classroom-listening', order: 26 }, Entry));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'mochi-classroom-panel', order: 26 }, Panel));
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = '.mochi-classroom-backdrop{position:fixed;inset:0;z-index:1100;background:#0003;display:grid;place-items:center}.mochi-classroom-panel{background:var(--bg-primary,#fffaf1);color:var(--text-primary,#493c32);width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;padding:24px;border-radius:20px;box-shadow:0 12px 50px #0002}.mochi-classroom-panel header,.mochi-classroom-actions{display:flex;gap:12px;align-items:center;justify-content:space-between}.mochi-classroom-paper{margin-top:18px;padding:20px;background:#fffdf8;border:1px solid #d9cbbb;border-radius:12px;color:#493c32}.mochi-classroom-paper textarea{width:100%;resize:vertical;background:transparent;color:inherit;line-height:1.7;border:1px solid #bfae99;border-radius:8px;padding:10px}'; document.head.append(style);
    window.mochiClassroomListening = api; window.addEventListener('mochi-classroom-audio-busy', busy);
    const stopAudioActivity = window.mochiClassroomDesktop?.onAudioActivity?.(detail => window.dispatchEvent(new CustomEvent('mochi-classroom-audio-busy', { detail })));
    const stopOpenLetter = window.mochiClassroomDesktop?.onOpenLetter?.(id => { if (!host) { pendingLetterId = id; return; } if (host.letters.some(letter => letter.id === id)) { selected = id; open = true; notify(); } });
    // Verified 0.2.0-rc.2 VoiceInput DOM lifecycle, including pending permission.
    let voiceBusy = false;
    const observeVoice = () => {
      const next = [...document.querySelectorAll('[data-voice-activity]')].some(node => ['requesting', 'recording', 'transcribing'].includes(node.getAttribute('data-voice-activity')));
      if (next === voiceBusy) return; voiceBusy = next;
      void (next ? pause('official-voice-input') : resume('official-voice-input'));
    };
    const observer = new MutationObserver(observeVoice); observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-voice-activity'] }); observeVoice();
    const poll = async () => {
      try {
        await read();
        const provider = selectedProvider(host);
        if (host.settings.autoStartListening && !reasons.size && controller.state === 'stopped' && ['ready', 'standby'].includes(provider?.preparation.phase) && provider.location === 'host-local') await controller.start();
      } catch (error) { if (!disposed && host) { status = { ...status, error: error.message }; notify(); } }
      finally { if (!disposed) timer = setTimeout(poll, 3000); }
    };
    void window.mochiClassroomDesktop?.getStartup?.().then(value => { startup = value; notify(); }).catch(error => { status = { ...status, error: error.message }; notify(); });
    void poll();
    return async () => { disposed = true; clearTimeout(timer); observer.disconnect(); style.remove(); stopOpenLetter?.(); stopAudioActivity?.(); window.removeEventListener('mochi-classroom-audio-busy', busy); if (window.mochiClassroomListening === api) delete window.mochiClassroomListening; await controller.stop(); };
  });
}
