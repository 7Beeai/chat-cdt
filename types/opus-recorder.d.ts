// opus-recorder não traz tipos. Declaração mínima cobrindo o que usamos.
// API: https://github.com/chris-rudmin/opus-recorder
declare module 'opus-recorder' {
  export interface RecorderConfig {
    bufferLength?: number
    encoderPath?: string
    mediaTrackConstraints?: MediaTrackConstraints | boolean
    monitorGain?: number
    numberOfChannels?: number
    recordingGain?: number
    sourceNode?: MediaStreamAudioSourceNode
    /** 2048 = Voice, 2049 = Full Band Audio, 2051 = Restricted Low Delay. */
    encoderApplication?: number
    encoderBitRate?: number
    encoderComplexity?: number
    encoderFrameSize?: number
    /** 8000 | 12000 | 16000 | 24000 | 48000. Default 48000. */
    encoderSampleRate?: number
    maxFramesPerPage?: number
    originalSampleRateOverride?: number
    resampleQuality?: number
    /** Quando true, ondataavailable dispara por página; senão, uma vez no stop. */
    streamPages?: boolean
  }

  export default class Recorder {
    constructor(config?: RecorderConfig)
    static isRecordingSupported(): boolean
    static version: string

    encodedSamplePosition: number

    ondataavailable: ((data: Uint8Array) => void) | null
    onstart: (() => void) | null
    onstop: (() => void) | null
    onpause: (() => void) | null
    onresume: (() => void) | null

    start(): Promise<void>
    stop(): void
    pause(flush?: boolean): Promise<void> | void
    resume(): void
    close(): void
    setRecordingGain(gain: number): void
    setMonitorGain(gain: number): void
  }
}
