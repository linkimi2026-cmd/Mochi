/* One deterministic motion layer for the full film. Product DOM stays untouched. */
(function () {
  const cursorSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M3 2V30L10.5 23L17.5 37L23 34L16 21H28Z" fill="#242824" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';

  function createCursor(stage) {
    const layer = document.createElement('div');
    layer.className = 'film-pointer-layer';
    layer.setAttribute('aria-hidden', 'true');
    const cursor = document.createElement('img');
    cursor.className = 'film-pointer';
    cursor.src = `data:image/svg+xml,${encodeURIComponent(cursorSvg)}`;
    cursor.width = 48;
    cursor.height = 60;
    const ring = document.createElement('div');
    ring.className = 'film-pointer-ring';
    layer.append(ring, cursor);
    stage.append(layer);
    return {cursor, ring};
  }

  function movePointer(tl, pointer, from, to, at, duration = .72) {
    // Coordinates describe the arrow tip, not the image centre. Never scale the cursor.
    tl.fromTo(pointer.cursor,
      {x: from.x - 4.5, y: from.y - 3, opacity: 1},
      {x: to.x - 4.5, y: to.y - 3, opacity: 1, duration, ease: 'power3.inOut', immediateRender: false}, at);
  }

  function click(tl, pointer, point, at) {
    tl.fromTo(pointer.ring,
      {x: point.x - 40, y: point.y - 40, scale: .2, opacity: .8},
      {scale: 1.15, opacity: 0, duration: .5, ease: 'power2.out', immediateRender: false}, at);
  }

  function place(tl, element, from, to, at, duration = 1.1, ease = 'power3.inOut') {
    tl.fromTo(element, {...from, transformOrigin: '0 0'},
      {...to, duration, ease, immediateRender: false}, at);
  }

  function words(tl, element, text, at, duration) {
    // Tweening a setter survives seek(..., true); onUpdate would be suppressed.
    const letters = Array.from(text);
    const state = {};
    Object.defineProperty(state, 'count', {get: () => 0, set: value => {
      element.textContent = letters.slice(0, Math.floor(value)).join('');
    }});
    tl.fromTo(state, {count: 0}, {count: letters.length, duration, ease: 'none', immediateRender: false}, at);
  }

  window.MochiMotion = {createCursor, movePointer, click, place, words};
})();
