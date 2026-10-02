/* Editorial paper choreography. Source content is cloned from the real component. */
(function () {
  const plane = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 430"><path d="M20 80L680 120L220 235Z" fill="#fffdf5"/><path d="M220 235L680 120L305 390Z" fill="#e5eadc"/><path d="M220 235L280 300L680 120Z" fill="#b9c7ac"/><path d="M280 300L305 390L680 120Z" fill="#f6f4e8"/><path d="M20 80L680 120L305 390L280 300L220 235Z" fill="none" stroke="#73816a" stroke-width="2" stroke-linejoin="round"/></svg>';

  const envelope = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 430"><rect x="35" y="35" width="630" height="360" rx="12" fill="#fdfaf1" stroke="#73816a" stroke-width="2"/><path d="M35 395L350 155L665 395Z" fill="#e5eadc"/><path d="M35 35L350 265L665 35Z" fill="#f4f1e5" stroke="#a4b099" stroke-width="2" stroke-linejoin="round"/><circle cx="350" cy="259" r="24" fill="#687e60"/></svg>';

  function transfer(tl, {stage, source, at, from, to, duration = 1.3, form = 'plane'}) {
    const courier = document.createElement('div');
    courier.className = 'paper-courier';
    courier.setAttribute('aria-hidden', 'true');
    const sheet = document.createElement('div');
    sheet.className = 'courier-sheet';
    const clips = [
      'polygon(0 0,50% 0,50% 100%,0 100%)',
      'polygon(50% 0,100% 0,100% 100%,50% 100%)',
    ];
    clips.forEach((clip, i) => {
      const panel = document.createElement('div');
      panel.className = `courier-panel courier-panel-${i}`;
      panel.style.clipPath = clip;
      const content = source.cloneNode(true);
      content.removeAttribute('id');
      content.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      content.className = 'native mochi-lan-mailbox courier-content';
      panel.append(content);
      sheet.append(panel);
      tl.fromTo(panel, {rotationY: 0, rotationX: 0}, {
        rotationY: i ? -72 : 72, rotationX: i ? -12 : 12,
        duration: .62, ease: 'power2.inOut', immediateRender: false,
      }, at + .12 + i * .09);
    });
    const glider = document.createElement('img');
    glider.className = 'courier-plane';
    glider.width = 700;
    glider.height = 430;
    glider.src = `data:image/svg+xml,${encodeURIComponent(form === 'envelope' ? envelope : plane)}`;
    courier.append(sheet, glider);
    stage.append(courier);
    tl.set(courier, {autoAlpha: 0}, 0);
    tl.fromTo(courier, {autoAlpha: 0}, {autoAlpha: 1, duration: .12, immediateRender: false}, at);
    tl.fromTo(sheet, {autoAlpha: 1}, {autoAlpha: 0, duration: .28, immediateRender: false}, at + .58);
    tl.fromTo(glider, {autoAlpha: 0, rotationX: 55, scale: .78}, {
      autoAlpha: 1, rotationX: 0, scale: 1, duration: .4,
      ease: 'back.out(1.4)', immediateRender: false,
    }, at + .55);
    const bend = Math.min(from.y, to.y) - 260;
    const state = {};
    Object.defineProperty(state, 'progress', {get: () => 0, set: progress => {
      const t = Math.max(0, Math.min(1, progress)), u = 1 - t;
      const x = u * u * from.x + 2 * u * t * ((from.x + to.x) / 2) + t * t * to.x;
      const y = u * u * from.y + 2 * u * t * bend + t * t * to.y;
      const angle = -14 + 35 * t;
      courier.style.transform = `translate3d(${x}px,${y}px,0) rotate(${angle}deg) scale(.48)`;
    }});
    tl.set(state, {progress: 0}, 0);
    tl.fromTo(state, {progress: 0}, {progress: 1, duration, ease: 'power2.inOut', immediateRender: false}, at + .8);
    tl.to(courier, {autoAlpha: 0, duration: .2, ease: 'power2.in'}, at + .8 + duration);
    return at + .8 + duration;
  }
  window.MochiPaper = {transfer};
})();
