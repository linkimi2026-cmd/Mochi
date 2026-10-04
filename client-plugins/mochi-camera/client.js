window.__ModuleLoader__.load({
  id: 'mochi-camera-client',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const SLOT = 'conversation.input.left';

    function stopStream(stream) {
      for (const track of stream?.getTracks() || []) track.stop();
    }

    function createCapture(mediaDevices, onStream, onEnded) {
      let generation = 0;
      let current = null;
      function stop() {
        generation++;
        const active = current;
        current = null;
        stopStream(active);
        onStream(null);
      }
      async function start(deviceId) {
        stop();
        const ticket = generation;
        if (!mediaDevices?.getUserMedia) throw new Error('当前环境无法使用摄像头。');
        const stream = await mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (ticket !== generation) {
          stopStream(stream);
          return null;
        }
        current = stream;
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => {
            if (current !== stream) return;
            stop();
            onEnded();
          }, { once: true });
        }
        onStream(stream);
        return stream;
      }
      return { start, stop };
    }

    async function photograph(video, makeCanvas = () => document.createElement('canvas')) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height || video.readyState < 2) throw new Error('画面尚未就绪，请稍后拍照。');
      const scale = Math.min(1, 2400 / Math.max(width, height));
      const canvas = makeCanvas();
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法生成题目图片。');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob || blob.size === 0) reject(new Error('拍照失败，请重试。'));
          else resolve(blob);
        }, 'image/jpeg', 0.92);
      });
    }

    function addPhoto(conversation, inputActions, sessionId, file) {
      const drafts = conversation.createDrafts(sessionId, [file]);
      try {
        if (!inputActions.addAttachments(drafts.map((draft) => draft.id))) {
          throw new Error('当前草稿正在提交，请稍后重新拍照。');
        }
      } catch (error) {
        conversation.releaseDraftAttachments(drafts);
        throw error;
      }
    }

    function mediaError(error) {
      if (error?.name === 'NotAllowedError') return '摄像头权限未获允许，请在系统隐私设置中允许 Mochi 使用摄像头后重试。';
      if (error?.name === 'NotFoundError') return '未找到摄像头或展台，请接好设备后重试。';
      if (error?.name === 'NotReadableError') return '设备暂时无法打开，可能正在被其他程序使用。请检查后重试。';
      if (error?.name === 'OverconstrainedError') return '所选设备已不可用，请重新选择摄像头或展台。';
      return error instanceof Error ? error.message : '摄像头打开失败，请重试。';
    }

    function CameraControl({ sessionId, inputActions, useInput, useProjection, addPhotoToDraft }) {
      const input = useInput((state) => state);
      const projection = useProjection('mochiCamera');
      const [open, setOpen] = React.useState(false);
      const [phase, setPhase] = React.useState('idle');
      const [devices, setDevices] = React.useState([]);
      const [deviceId, setDeviceId] = React.useState('');
      const [message, setMessage] = React.useState('');
      const [ready, setReady] = React.useState(false);
      const video = React.useRef(null);
      const dialog = React.useRef(null);
      const capture = React.useRef(null);
      const active = React.useRef(false);
      const generation = React.useRef(0);
      const lastRequest = React.useRef(undefined);
      const locked = input.phase === 'adjudicating' || input.phase === 'submitting'
        || input.claim?.attachments === false;

      function close() {
        active.current = false;
        generation.current++;
        capture.current?.stop();
        setOpen(false);
        setPhase('idle');
        setReady(false);
      }

      React.useEffect(() => {
        setOpen(false);
        setPhase('idle');
        setReady(false);
        lastRequest.current = undefined;
        const media = navigator.mediaDevices;
        const instance = createCapture(media, (stream) => {
          if (video.current) {
            video.current.srcObject = stream;
            if (stream) video.current.play().catch(() => {});
          }
        }, () => {
          if (!active.current) return;
          setPhase('idle');
          setReady(false);
          setMessage('设备已断开，请重新选择或连接设备。');
        });
        capture.current = instance;
        const pause = () => {
          if (document.visibilityState === 'hidden') close();
        };
        const refresh = () => media.enumerateDevices().then((items) => {
          if (active.current) setDevices(items.filter((item) => item.kind === 'videoinput'));
        }).catch(() => {});
        document.addEventListener('visibilitychange', pause);
        window.addEventListener('pagehide', close);
        media?.addEventListener('devicechange', refresh);
        return () => {
          active.current = false;
          generation.current++;
          instance.stop();
          document.removeEventListener('visibilitychange', pause);
          window.removeEventListener('pagehide', close);
          media?.removeEventListener('devicechange', refresh);
        };
      }, [sessionId]);

      React.useEffect(() => {
        if (!dialog.current) return;
        if (open && !dialog.current.open) dialog.current.showModal();
        if (!open && dialog.current.open) dialog.current.close();
      }, [open]);

      React.useEffect(() => {
        if (projection === undefined) return;
        const request = projection?.request;
        if (lastRequest.current === undefined) {
          lastRequest.current = request?.requestId || null;
          return;
        }
        if (!request || lastRequest.current === request.requestId) return;
        lastRequest.current = request.requestId;
        // A resumed log cannot switch the camera on; only a fresh request opens the preview.
        if (Date.now() - request.requestedAt > 60000 || request.requestedAt > Date.now() + 5000) return;
        start(deviceId);
      }, [projection]);

      async function start(chosen) {
        active.current = true;
        const ticket = ++generation.current;
        setOpen(true);
        setPhase('opening');
        setReady(false);
        setMessage('');
        try {
          const stream = await capture.current.start(chosen);
          if (!stream || !active.current || generation.current !== ticket) return;
          const selected = stream.getVideoTracks()[0]?.getSettings().deviceId || chosen || '';
          setDeviceId(selected);
          setPhase('preview');
          const items = await navigator.mediaDevices.enumerateDevices();
          if (active.current && generation.current === ticket) setDevices(items.filter((item) => item.kind === 'videoinput'));
        } catch (error) {
          if (!active.current || generation.current !== ticket) return;
          capture.current.stop();
          setPhase('idle');
          setMessage(mediaError(error));
        }
      }

      async function takePhoto() {
        if (locked || phase !== 'preview' || !ready) return;
        const ticket = generation.current;
        setPhase('capturing');
        try {
          const blob = await photograph(video.current);
          if (!active.current || generation.current !== ticket) return;
          const file = new File([blob], `拍题-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' });
          addPhotoToDraft(inputActions, file);
          close();
          setMessage('照片已加入当前草稿，请检查后发送。');
        } catch (error) {
          if (!active.current || generation.current !== ticket) return;
          setPhase('preview');
          setMessage(mediaError(error));
        }
      }

      return h('div', { className: 'mochi-camera' },
        h('button', {
          type: 'button', className: 'mochi-camera__entry', disabled: locked,
          onClick: () => start(deviceId),
          'aria-label': '摄像头或展台拍题',
        }, '拍题'),
        !open && message ? h('span', { className: 'mochi-camera__notice', role: 'status' }, message) : null,
        h('dialog', { ref: dialog, className: 'mochi-camera__dialog', 'aria-labelledby': `mochi-camera-title-${sessionId}`, onCancel: (event) => { event.preventDefault(); close(); } },
          h('div', { className: 'mochi-camera__header' },
            h('h2', { id: `mochi-camera-title-${sessionId}` }, '摄像头 / 展台拍题'),
            h('button', { type: 'button', onClick: close, 'aria-label': '关闭拍题并释放设备' }, '关闭')),
          h('p', null, '把题目放进画面。拍好的图片会先放到草稿，检查清楚后再发送。'),
          h('label', null, '视频设备 ', h('select', {
            'aria-label': '视频设备', value: deviceId, disabled: phase === 'opening' || phase === 'capturing',
            onChange: (event) => { setDeviceId(event.target.value); if (phase === 'preview') start(event.target.value); },
          }, h('option', { value: '' }, '系统默认摄像头'), devices.map((device, index) => h('option', {
            value: device.deviceId, key: device.deviceId,
          }, device.label || `视频设备 ${index + 1}`)))),
          h('video', { ref: video, autoPlay: true, playsInline: true, muted: true, className: 'mochi-camera__video',
            onLoadedData: () => setReady(true), 'aria-label': '摄像头预览' }),
          h('div', { className: 'mochi-camera__footer' },
            phase === 'idle' ? h('button', { type: 'button', onClick: () => start(deviceId), autoFocus: true }, '开启预览') : null,
            phase === 'opening' ? h('span', { role: 'status' }, '正在打开设备…') : null,
            h('button', { type: 'button', disabled: phase !== 'preview' || !ready || locked, onClick: takePhoto }, phase === 'capturing' ? '正在拍照…' : '拍照并加入草稿'),
            h('button', { type: 'button', onClick: close }, '取消')),
          message ? h('p', { role: 'status' }, message) : null));
    }

    function installStyles() {
      const style = document.createElement('style');
      style.textContent = '.mochi-camera{display:flex;align-items:center;gap:8px}.mochi-camera button,.mochi-camera select{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:9px;background:var(--dsw-alias-bg-base,#fffefa);padding:6px 10px;cursor:pointer}.mochi-camera button:disabled{opacity:.5;cursor:default}.mochi-camera button:focus-visible,.mochi-camera select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ad7450);outline-offset:2px}.mochi-camera__entry{font-size:12px!important}.mochi-camera__notice{font-size:11px;color:var(--dsw-alias-label-secondary,#746c60)}.mochi-camera__dialog{width:min(680px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:16px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32)}.mochi-camera__dialog::backdrop{background:#0006}.mochi-camera__header,.mochi-camera__footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.mochi-camera__header h2{font-size:18px;margin:0}.mochi-camera__dialog p{font-size:13px;line-height:1.6}.mochi-camera__video{display:block;width:100%;max-height:52vh;aspect-ratio:16/9;object-fit:contain;background:#171717;margin:16px 0;border-radius:9px}.mochi-camera__dialog label{display:flex;align-items:center;gap:8px;font-size:13px}.mochi-camera__dialog select{min-width:0;flex:1}.mochi-camera__footer{justify-content:flex-end;flex-wrap:wrap}';
      document.head.appendChild(style);
      return () => style.remove();
    }

    function apply(ctx) {
      ctx.effect(installStyles, 'mochi-camera: styles');
      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: 'mochi-camera',
        order: 30,
        inject: (sessionId) => ({
          addPhotoToDraft: (actions, file) => addPhoto(ctx.conversation, actions, sessionId, file),
        }),
      }, CameraControl));
    }

    return {
      apply,
      inject: ['slots', 'conversation'],
      __test: { createCapture, photograph, addPhoto, mediaError, CameraControl },
    };
  },
});
