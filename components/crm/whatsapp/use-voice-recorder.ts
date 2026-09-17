'use client';

import * as React from 'react';

import { webmOpusToOgg } from '@/lib/media/webm-to-ogg';

/* ============================================================================
 * RECORDING A VOICE NOTE
 * ----------------------------------------------------------------------------
 * ⚠️ MONO THROUGH WEB AUDIO, because WhatsApp takes a voice note only as mono
 * OGG/OPUS, and a stereo laptop microphone would otherwise record two channels.
 * The same graph feeds the level meter, so the bars move with the voice.
 *
 * ⚠️ AND CONVERTED, NOT RE-ENCODED. Chrome records WebM/Opus; the packets are
 * lifted into Ogg by `lib/media/webm-to-ogg.ts` (proved by decoding the result in
 * Chrome). Firefox records Ogg already. Safari records neither — its MP4 is sent
 * as an ordinary audio file, which WhatsApp accepts, without the voice-note look.
 * ========================================================================= */

export type RecorderState = 'idle' | 'asking' | 'recording' | 'paused';

export interface VoiceResult {
  readonly blob: Blob;
  readonly mime: string;
  readonly voice: boolean;
  readonly seconds: number;
  readonly filename: string;
}

const MAX_SECONDS = 15 * 60;

export function useVoiceRecorder(onError: (message: string) => void) {
  const [state, setState] = React.useState<RecorderState>('idle');
  const [elapsed, setElapsed] = React.useState(0);
  const [levels, setLevels] = React.useState<number[]>([]);

  const rec = React.useRef<MediaRecorder | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const stream = React.useRef<MediaStream | null>(null);
  const ctx = React.useRef<AudioContext | null>(null);
  const tick = React.useRef<number | null>(null);
  const started = React.useRef(0);
  const pausedFor = React.useRef(0);
  const pausedAt = React.useRef(0);

  const cleanup = React.useCallback(() => {
    if (tick.current) window.clearInterval(tick.current);
    tick.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    rec.current = null;
  }, []);

  React.useEffect(() => cleanup, [cleanup]);

  const start = React.useCallback(async () => {
    if (state !== 'idle') return;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError('This browser cannot record audio.');
      return;
    }
    setState('asking');
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = mic;
      const audio = new AudioContext();
      ctx.current = audio;
      const source = audio.createMediaStreamSource(mic);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      const mono = audio.createMediaStreamDestination();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      source.connect(analyser);
      source.connect(mono);

      const mime = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const recorder = new MediaRecorder(mono.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
      chunks.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      recorder.start(250);
      rec.current = recorder;

      started.current = performance.now();
      pausedFor.current = 0;
      setElapsed(0);
      setLevels([]);
      const buf = new Uint8Array(analyser.fftSize);
      tick.current = window.setInterval(() => {
        if (rec.current?.state !== 'recording') return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        setLevels((l) => [...l.slice(-47), level]);
        const secs = (performance.now() - started.current - pausedFor.current) / 1000;
        setElapsed(secs);
        if (secs >= MAX_SECONDS) rec.current?.pause();
      }, 100);
      setState('recording');
    } catch (error) {
      cleanup();
      setState('idle');
      onError(
        (error as { name?: string }).name === 'NotAllowedError'
          ? 'The microphone is blocked. Allow it from the icon in the address bar, then try again.'
          : 'No microphone could be opened.',
      );
    }
  }, [state, cleanup, onError]);

  const pause = React.useCallback(() => {
    if (rec.current?.state !== 'recording') return;
    rec.current.pause();
    pausedAt.current = performance.now();
    setState('paused');
  }, []);

  const resume = React.useCallback(() => {
    if (rec.current?.state !== 'paused') return;
    pausedFor.current += performance.now() - pausedAt.current;
    rec.current.resume();
    setState('recording');
  }, []);

  const cancel = React.useCallback(() => {
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
    cleanup();
    chunks.current = [];
    setState('idle');
    setElapsed(0);
    setLevels([]);
  }, [cleanup]);

  /** Stop and hand back a file WhatsApp will take. */
  const finish = React.useCallback(async (): Promise<VoiceResult | null> => {
    const recorder = rec.current;
    if (!recorder) return null;
    const mime = recorder.mimeType;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state === 'paused') pausedFor.current += performance.now() - pausedAt.current;
    const seconds = (performance.now() - started.current - pausedFor.current) / 1000;
    recorder.stop();
    await stopped;
    cleanup();
    setState('idle');
    setElapsed(0);
    setLevels([]);

    const raw = new Blob(chunks.current, { type: mime });
    chunks.current = [];
    if (seconds < 0.8 || raw.size === 0) {
      onError('Hold on a little longer — that recording was too short.');
      return null;
    }
    try {
      if (mime.startsWith('audio/webm')) {
        const { ogg, seconds: exact } = webmOpusToOgg(new Uint8Array(await raw.arrayBuffer()));
        return {
          blob: new Blob([ogg as BlobPart], { type: 'audio/ogg' }),
          mime: 'audio/ogg',
          voice: true,
          seconds: exact || seconds,
          filename: 'voice-message.ogg',
        };
      }
      if (mime.startsWith('audio/ogg')) {
        return { blob: new Blob([raw], { type: 'audio/ogg' }), mime: 'audio/ogg', voice: true, seconds, filename: 'voice-message.ogg' };
      }
      return { blob: new Blob([raw], { type: 'audio/mp4' }), mime: 'audio/mp4', voice: false, seconds, filename: 'voice-message.m4a' };
    } catch {
      onError('That recording could not be prepared for WhatsApp.');
      return null;
    }
  }, [cleanup, onError]);

  return { state, elapsed, levels, start, pause, resume, cancel, finish };
}
