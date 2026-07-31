/**
 * 提醒响铃音效：用 Web Audio API 合成一段柔和的双音提示音，无需任何音频资源文件。
 *
 * 浏览器自动播放策略：AudioContext 必须在用户手势（点击/触摸）后才能发声。
 * 因此首次交互时调用 unlockAudio() 解锁；playAlarm() 在播放前也会尝试 resume。
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** 在首次用户手势时调用，解锁音频上下文（绕过自动播放限制）。 */
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

/** 播放一段柔和的双音提示音（C5 → G5，轻缓淡出）。 */
export function playAlarm(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();

  const now = c.currentTime;
  // 两个音：523.25Hz(C5) 与 783.99Hz(G5)，整体 0.6s，音量柔和、指数淡出避免爆音
  const beep = (freq: number, start: number, dur: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  };
  beep(523.25, now, 0.32);
  beep(783.99, now + 0.18, 0.42);
}
