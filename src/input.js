// Klávesnice + dotyková tlačítka
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, drift: false };
    this.actions = new Set(); // jednorázové akce: switch, camera, reset, horn
    const map = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'drift',
    };
    const once = { KeyT: 'switch', KeyC: 'camera', KeyR: 'reset', KeyH: 'horn', KeyM: 'mute', KeyN: 'map' };
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
    };
  }

  take(name) {
    const had = this.actions.has(name);
    this.actions.delete(name);
    return had;
  }
}
