// @ts-ignore
import * as lamejs from 'lamejs';

/**
 * Global AudioContext instance to avoid creating too many contexts.
 */
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioContext = new AudioContextClass();
  }
  
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume();
  }
  
  return sharedAudioContext;
}

/**
 * Writes a string to a DataView.
 */
function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encodes an AudioBuffer to a WAV Blob (16-bit PCM).
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result: Float32Array;
  if (numChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  return encodeWAV(result, numChannels, sampleRate, format, bitDepth);
}

/**
 * Encodes an AudioBuffer to an MP3 Blob using lamejs.
 */
export function audioBufferToMp3(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samplesLeft = buffer.getChannelData(0);
  const samplesRight = channels > 1 ? buffer.getChannelData(1) : undefined;
  
  // Lamejs requires Int16 samples
  const convertBuffer = (samples: Float32Array) => {
    const len = samples.length;
    const result = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return result;
  };

  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128); // 128kbps
  const samplesLeftInt16 = convertBuffer(samplesLeft);
  const samplesRightInt16 = samplesRight ? convertBuffer(samplesRight) : undefined;

  const mp3Data = [];
  
  // Encode in chunks to avoid blocking too much (though this runs sync here)
  const sampleBlockSize = 1152;
  const length = samplesLeftInt16.length;
  
  for (let i = 0; i < length; i += sampleBlockSize) {
    const leftChunk = samplesLeftInt16.subarray(i, i + sampleBlockSize);
    let mp3buf;
    
    if (channels === 2 && samplesRightInt16) {
      const rightChunk = samplesRightInt16.subarray(i, i + sampleBlockSize);
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    }
    
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function encodeWAV(
  samples: Float32Array,
  numChannels: number,
  sampleRate: number,
  format: number,
  bitDepth: number
): Blob {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * bytesPerSample, true);

  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: 'audio/wav' });
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

/**
 * Decodes an audio file (Blob/File) into an AudioBuffer.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = getAudioContext();
  return await audioContext.decodeAudioData(arrayBuffer);
}

/**
 * Merges multiple audio buffers into one sequential buffer.
 */
export function mergeBuffers(buffers: AudioBuffer[]): AudioBuffer {
  const audioContext = getAudioContext();
  const outputChannels = buffers[0].numberOfChannels;
  const sampleRate = buffers[0].sampleRate;
  
  // Calculate total length
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  
  const result = audioContext.createBuffer(outputChannels, totalLength, sampleRate);
  
  for (let channel = 0; channel < outputChannels; channel++) {
    const resultData = result.getChannelData(channel);
    let offset = 0;
    for (const buffer of buffers) {
      const bufferData = buffer.getChannelData(channel);
      resultData.set(bufferData, offset);
      offset += buffer.length;
    }
  }
  
  return result;
}

/**
 * Analyzes the AudioBuffer and removes silent sections.
 * Uses a Bandpass filter to isolate vocals before detection.
 */
export async function removeSilence(
  buffer: AudioBuffer,
  threshold: number = 0.02, // Slightly higher threshold for filtered audio
  minSilenceDuration: number = 0.4 
): Promise<AudioBuffer[]> {
  const audioContext = getAudioContext();
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;

  // 1. Voice Isolation (Bandpass Filter)
  // We use OfflineAudioContext to render a filtered version just for analysis
  const offlineCtx = new OfflineAudioContext(1, numSamples, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  // Highpass at 200Hz to remove rumble/bass
  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 200;

  // Lowpass at 3500Hz to remove high frequency noise/hiss
  const lowpass = offlineCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3500;

  // Connect graph
  // Note: we mix down to mono for analysis
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(offlineCtx.destination);
  
  source.start();
  const filteredBuffer = await offlineCtx.startRendering();
  const analysisData = filteredBuffer.getChannelData(0);

  // 2. Analysis using the filtered data
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
  const regionsToKeep: { start: number; end: number }[] = [];
  
  let isSpeaking = false;
  let startParams = 0;
  let silenceStart = 0;

  for (let i = 0; i < numSamples; i += windowSize) {
    let sum = 0;
    const end = Math.min(i + windowSize, numSamples);
    
    // Calculate RMS on the filtered (vocal only) data
    for (let j = i; j < end; j++) {
      sum += analysisData[j] * analysisData[j];
    }
    const rms = Math.sqrt(sum / (end - i));

    if (rms > threshold) {
      if (!isSpeaking) {
        isSpeaking = true;
        // Backtrack slightly to catch the breath/start of attack
        startParams = Math.max(0, i - sampleRate * 0.25); 
      }
      silenceStart = 0;
    } else {
      if (isSpeaking) {
        if (silenceStart === 0) {
          silenceStart = i;
        } else if ((i - silenceStart) / sampleRate > minSilenceDuration) {
          isSpeaking = false;
          // Add release trail
          regionsToKeep.push({ 
            start: startParams, 
            end: Math.min(numSamples, silenceStart + sampleRate * 0.2) 
          });
        }
      }
    }
  }

  if (isSpeaking || silenceStart > 0) {
     regionsToKeep.push({ 
      start: startParams, 
      end: numSamples 
    });
  }

  // If no regions found, maybe threshold was too high, return original as one chunk
  if (regionsToKeep.length === 0) {
    return [buffer];
  }

  // 3. Extract segments from Original Buffer (High Quality) based on analysis
  const outputBuffers: AudioBuffer[] = [];
  const channels = buffer.numberOfChannels;

  for (const region of regionsToKeep) {
    const length = region.end - region.start;
    if (length < 1000) continue; // Skip extremely tiny clips

    const newBuffer = audioContext.createBuffer(channels, length, sampleRate);

    for (let c = 0; c < channels; c++) {
      const inputData = buffer.getChannelData(c);
      const outputData = newBuffer.getChannelData(c);
      // Copy the specific region
      outputData.set(inputData.slice(region.start, region.end), 0);
    }
    outputBuffers.push(newBuffer);
  }

  return outputBuffers;
}

/**
 * Slices an AudioBuffer into multiple smaller AudioBuffers of a specific duration.
 */
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  segmentDuration: number
): AudioBuffer[] {
  const audioContext = getAudioContext();
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const length = buffer.length;
  const segmentLength = Math.floor(rate * segmentDuration);
  const segments: AudioBuffer[] = [];

  for (let offset = 0; offset < length; offset += segmentLength) {
    // Determine the length of this specific segment (last one might be shorter)
    const currentSegmentLength = Math.min(segmentLength, length - offset);
    
    // Create a new buffer for this segment
    const newBuffer = audioContext.createBuffer(channels, currentSegmentLength, rate);

    // Copy data for each channel
    for (let i = 0; i < channels; i++) {
      const channelData = buffer.getChannelData(i);
      // Slice the original channel data
      const segmentData = channelData.slice(offset, offset + currentSegmentLength);
      newBuffer.copyToChannel(segmentData, i);
    }

    segments.push(newBuffer);
  }

  return segments;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}