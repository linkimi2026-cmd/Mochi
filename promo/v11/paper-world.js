/* One editorial space for multiple real endpoints; no product UI is redrawn. */
(function () {
  function create(stage, tl) {
    const world = document.createElement('div');
    world.className = 'paper-world';
    world.setAttribute('aria-hidden', 'true');
    const floor = document.createElement('div');
    floor.className = 'paper-world-floor';
    const far = document.createElement('div');
    far.className = 'paper-world-far';
    const near = document.createElement('div');
    near.className = 'paper-world-near';
    const locations = [
      {x: 0, label: '教师端', tone: 'teacher'},
      {x: 2560, label: '教室端', tone: 'classroom'},
      {x: 5120, label: '校园协作', tone: 'campus'},
    ];
    for (const location of locations) {
      const room = document.createElement('div');
      room.className = `paper-room ${location.tone}`;
      room.style.left = `${location.x}px`;
      floor.append(room);
      for (let i = 0; i < 3; i++) {
        const page = document.createElement('div');
        page.className = `world-page world-page-${i}`;
        page.style.left = `${location.x + [-510, 2100, 2150][i]}px`;
        page.style.top = `${[550, -650, 1050][i]}px`;
        page.style.rotate = `${[-18, 23, -12][i]}deg`;
        far.append(page);
      }
      const edge = document.createElement('div');
      edge.className = 'world-paper-edge';
      edge.style.left = `${location.x - 750}px`;
      near.append(edge);
    }
    world.append(floor, far, near);
    stage.prepend(world);
    tl.set([floor, far, near], {x: 0}, 0);
    let position = 0;
    function travel(destination, at, duration = 2.6) {
      const next = -2560 * destination;
      for (const [element, ratio] of [[floor, 1], [far, .86], [near, 1.18]]) {
        tl.fromTo(element, {x: position * ratio}, {
          x: next * ratio, duration, ease: 'power2.inOut', immediateRender: false,
        }, at);
      }
      position = next;
    }
    return {travel};
  }
  window.MochiWorld = {create};
})();
