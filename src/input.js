// Klávesnice + dotyková tlačítka
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, drift: false };
    this.actions = new Set(); // jednorázové akce: switch, camera, reset, horn
    const map = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'drift',
      ShiftLeft: 'run', ShiftRight: 'run',
    };
    const once = { KeyT: 'switch', KeyC: 'camera', KeyR: 'reset', KeyH: 'horn', KeyM: 'mute', KeyN: 'map', KeyE: 'action', KeyF: 'exit' };
    // myš: rozhlížení (pointer lock) a tlačítka
    this.look = { dx: 0, dy: 0, last: 0 };
    const canvasEl = () => document.querySelector('#game canvas');
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvasEl() || this.dragging) {
        this.look.dx += e.movementX; this.look.dy += e.movementY; this.look.last = performance.now();
      }
    });
    addEventListener('mousedown', (e) => {
      if (e.target !== canvasEl()) return;
      const c = canvasEl();
      if (document.pointerLockElement !== c && !this.touchLike) {
        c.requestPointerLock?.();
        if (e.button === 0) return; // první klik jen zamkne myš
      }
      if (e.button === 0) this.actions.add('action');
      if (e.button === 2) this.actions.add('exit');
    });
    addEventListener('contextmenu', (e) => { if (e.target === canvasEl()) e.preventDefault(); });
    // dotyk: tažení po obrazovce = rozhlížení
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && e.target === canvasEl()) { this.dragging = e.pointerId; this.px = e.clientX; this.py = e.clientY; this.touchLike = true; } });
    addEventListener('pointermove', (e) => {
      if (e.pointerId === this.dragging) {
        this.look.dx += (e.clientX - this.px) * 1.5; this.look.dy += (e.clientY - this.py) * 1.5;
        this.px = e.clientX; this.py = e.clientY; this.look.last = performance.now();
      }
    });
    addEventListener('pointerup', (e) => { if (e.pointerId === this.dragging) this.dragging = null; });
    addEventListener('keydown', (e) => {
      if (map[e.code]) { this.keys.add(map[e.code]); e.preventDefault(); }
      if (once[e.code] && !e.repeat) this.actions.add(once[e.code]);
    });
    addEventListener('keyup', (e) => { if (map[e.code]) this.keys.delete(map[e.code]); });
    addEventListener('blur', () => this.keys.clear());

    document.querySelectorAll('[data-hold]').forEach((el) => {
      const k = el.dataset.hold;
      const on = (e) => { e.preventDefault(); this.touch[k] = true; el.classList.add('on'); el.setPointerCapture?.(e.pointerId); };
      const off = (e) => { e.preventDefault(); this.touch[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actions.add(el.dataset.action); });
    });
  }

  state() {
    const k = this.keys, t = this.touch;
    const up = k.has('up') || t.gas, down = k.has('down') || t.brake;
    const left = k.has('left') || t.left, right = k.has('right') || t.right;
    return {
      throttle: (up ? 1 : 0) - (down ? 1 : 0),
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      handbrake: k.has('drift') || t.drift,
      run: k.has('run') || t.drift,
    };
  }

  takeLook() {
    const l = { dx: this.look.dx, dy: this.look.dy, idle: performance.now() - this.look.last };
    this.look.dx = 0; this.look.dy = 0;
    return l;
  }

  take(name) {
    const had = this.actions.has(name);
    this.actions.delete(name);
    return had;
  }
}
