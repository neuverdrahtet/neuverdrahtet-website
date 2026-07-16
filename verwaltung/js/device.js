/**
 * Klassifiziert das aktuelle Gerät als 'phone' | 'tablet' | 'desktop' anhand
 * von Bildschirmbreite + Touch-Fähigkeit (nicht per User-Agent-String, da
 * der sich leicht fälschen lässt und bei Desktop-Chrome im Tablet-Modus
 * ohnehin nicht zuverlässig ist).
 */
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export function detectDeviceType() {
  const width = window.innerWidth;
  const touch = isTouchDevice();
  if (width <= 640) return 'phone';
  if (touch && width <= 1180) return 'tablet';
  if (!touch && width <= 880) return 'phone';
  return 'desktop';
}

let current = null;

export function getDeviceType() {
  return current || detectDeviceType();
}

export function applyDeviceClass() {
  const update = () => {
    current = detectDeviceType();
    document.documentElement.dataset.device = current;
    document.documentElement.dataset.touch = isTouchDevice() ? '1' : '0';
  };
  update();
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(update, 200);
  });
  window.addEventListener('orientationchange', update);
  return current;
}
