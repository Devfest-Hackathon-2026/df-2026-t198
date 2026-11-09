import type { StoryCue } from './timeline';

const notes: Record<StoryCue, readonly number[]> = {
  send: [523, 784], clock: [220, 277, 330, 440, 554, 660], schedule: [523, 659, 784], notify: [880, 659],
};

export class StorySound {
  private context: AudioContext | undefined;
  private voices = new Set<OscillatorNode>();

  async unlock(): Promise<boolean> {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
  }

  play(cue: StoryCue) {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    notes[cue].forEach((frequency, index) => {
      const start = context.currentTime + index * (cue === 'clock' ? .055 : .09);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(cue === 'clock' ? .018 : .045, start + .009);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .15);
      oscillator.connect(gain);
      gain.connect(context.destination);
      this.voices.add(oscillator);
      oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + .16);
    });
  }

  stop() {
    for (const voice of this.voices) { voice.stop(); voice.disconnect(); }
    this.voices.clear();
  }

  close() { this.stop(); void this.context?.close(); this.context = undefined; }
}
