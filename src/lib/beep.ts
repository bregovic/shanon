/**
 * Krátké tiché pípnutí (Web Audio, bez zvukového souboru) — potvrzení na pokladně, např. vážené zboží v nákupu.
 * Bez podpory zvuku nebo před první interakcí uživatele (zákaz automatického přehrávání) se nic nestane.
 */
let ctx: AudioContext | null = null;

export function beep(freq = 1046, ms = 90, volume = 0.05): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    // krátký náběh a doběh — bez lupnutí
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  } catch {
    /* bez zvuku */
  }
}
