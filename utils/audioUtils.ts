
/**
 * Global AudioContext instance to avoid creating too many contexts.
 */
let sharedAudioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
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

  const lamejs = (window as any).lamejs;
  if (!lamejs) {
    console.error("lamejs not found in window");
    throw new Error("Bibliotecas de áudio não carregadas. Por favor recarregue a página.");
  }

  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128); // 128kbps default, implies variable roughly
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

// ---------------- NEW FUNCTIONS ----------------

/**
 * Format seconds to MM:SS string.
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Slices an AudioBuffer into chunks of specific duration.
 */
export function sliceAudioBuffer(buffer: AudioBuffer, segmentDuration: number): AudioBuffer[] {
  const audioContext = getAudioContext();
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const len = buffer.length;
  const segmentLen = Math.floor(segmentDuration * sampleRate);
  
  const chunks: AudioBuffer[] = [];
  
  // Fade duration (10ms) to prevent clicks at cut points
  const fadeLen = Math.floor(sampleRate * 0.01); 

  for (let i = 0; i < len; i += segmentLen) {
    const end = Math.min(i + segmentLen, len);
    const chunkLen = end - i;
    
    // Ignore extremely short end chunks (< 0.1s)
    if (chunkLen < sampleRate * 0.1) continue;

    const chunkBuffer = audioContext.createBuffer(channels, chunkLen, sampleRate);
    
    for (let c = 0; c < channels; c++) {
      const channelData = buffer.getChannelData(c);
      const chunkData = chunkBuffer.getChannelData(c);
      const subArray = channelData.subarray(i, end);
      chunkData.set(subArray);

      // Apply fade out/in to ends to prevent clicks
      // Fade In
      for (let j = 0; j < fadeLen && j < chunkLen; j++) {
        chunkData[j] *= (j / fadeLen);
      }
      // Fade Out
      for (let j = 0; j < fadeLen && j < chunkLen; j++) {
        chunkData[chunkLen - 1 - j] *= (j / fadeLen);
      }
    }
    
    chunks.push(chunkBuffer);
  }
  
  return chunks;
}

/**
 * Analyzes the AudioBuffer and removes silent sections.
 */
export async function removeSilence(
  buffer: AudioBuffer,
  threshold: number = 0.02, 
  minSilenceDuration: number = 0.4 
): Promise<AudioBuffer[]> {
  const audioContext = getAudioContext();
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;

  const offlineCtx = new OfflineAudioContext(1, numSamples, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 200;

  const lowpass = offlineCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3500;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(offlineCtx.destination);
  
  source.start();
  const filteredBuffer = await offlineCtx.startRendering();
  const analysisData = filteredBuffer.getChannelData(0);

  const windowSize = Math.floor(sampleRate * 0.05); 
  const regionsToKeep: { start: number; end: number }[] = [];
  
  let isSpeaking = false;
  let speechStart = 0;
  let silenceDuration = 0;

  for (let i = 0; i < numSamples; i += windowSize) {
    let sum = 0;
    const end = Math.min(i + windowSize, numSamples);
    
    for (let j = i; j < end; j++) {
      sum += Math.abs(analysisData[j]);
    }
    const avg = sum / (end - i);
    
    if (avg > threshold) {
        if (!isSpeaking) {
            isSpeaking = true;
            speechStart = i;
        }
        silenceDuration = 0;
    } else {
        if (isSpeaking) {
            silenceDuration += (end - i) / sampleRate;
            if (silenceDuration > minSilenceDuration) {
                isSpeaking = false;
                regionsToKeep.push({ start: speechStart, end: i });
            }
        }
    }
  }

  // If ended while speaking
  if (isSpeaking) {
    regionsToKeep.push({ start: speechStart, end: numSamples });
  }

  // Extract real audio from original buffer
  const resultBuffers: AudioBuffer[] = [];
  
  for (const region of regionsToKeep) {
     const len = region.end - region.start;
     if (len < sampleRate * 0.1) continue; // Skip very short
     
     const newBuf = audioContext.createBuffer(buffer.numberOfChannels, len, sampleRate);
     for (let c = 0; c < buffer.numberOfChannels; c++) {
         const chanIn = buffer.getChannelData(c);
         const chanOut = newBuf.getChannelData(c);
         chanOut.set(chanIn.subarray(region.start, region.end));
     }
     resultBuffers.push(newBuf);
  }
  
  return resultBuffers;
}

/**
 * Trims silence/hiss from start and end of buffer using RMS Energy detection.
 * Includes micro-fades to prevent clicks.
 */
export function trimAudio(buffer: AudioBuffer, threshold: number = 0.015): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const len = buffer.length;
  const sampleRate = buffer.sampleRate;
  
  // Use a window to calculate average energy (RMS-like) to ignore sporadic noise/hiss
  // 50ms window size is standard for envelope detection
  const windowSize = Math.floor(sampleRate * 0.05); 
  let start = 0;
  let end = len;

  // 1. Find Start (Attack)
  // We scan in windows. If the average amplitude of a window is > threshold, 
  // that's where the audio likely starts.
  for (let i = 0; i < len; i += windowSize) {
    let sum = 0;
    let count = 0;
    const limit = Math.min(i + windowSize, len);
    
    // Sum amplitude across all channels for this window
    for (let j = i; j < limit; j++) {
         for (let c = 0; c < numChannels; c++) {
             sum += Math.abs(buffer.getChannelData(c)[j]);
             count++;
         }
    }
    
    const avg = sum / count;
    
    // Found significant signal
    if (avg > threshold) {
        // Backtrack one window to ensure we catch the initial transient breath/attack
        start = Math.max(0, i - windowSize); 
        break;
    }
  }

  // 2. Find End (Decay)
  // Scan backwards
  for (let i = len; i > 0; i -= windowSize) {
    let sum = 0;
    let count = 0;
    const startWindow = Math.max(0, i - windowSize);
    
    for (let j = startWindow; j < i; j++) {
        for (let c = 0; c < numChannels; c++) {
             sum += Math.abs(buffer.getChannelData(c)[j]);
             count++;
         }
    }

    const avg = sum / count;
    
    if (avg > threshold) {
        // Add a bit of tail (one window) to avoid cutting reverb tails too abruptly
        end = Math.min(len, i + windowSize);
        break;
    }
  }

  // If silent or signal too low throughout
  if (start >= end) {
      return buffer; 
  }

  const newLen = end - start;
  const audioContext = getAudioContext();
  const newBuffer = audioContext.createBuffer(numChannels, newLen, sampleRate);

  // 3. Create new buffer and Apply Fade In/Out
  const fadeDuration = 0.02; // 20ms fade to prevent clicks
  const fadeSamples = Math.floor(sampleRate * fadeDuration);

  for (let c = 0; c < numChannels; c++) {
     const originalData = buffer.getChannelData(c);
     const newData = newBuffer.getChannelData(c);
     
     // Copy data
     newData.set(originalData.subarray(start, end));
     
     // Apply Fade In
     for (let i = 0; i < fadeSamples && i < newLen; i++) {
         newData[i] *= (i / fadeSamples);
     }
     
     // Apply Fade Out
     for (let i = 0; i < fadeSamples && i < newLen; i++) {
         const index = newLen - 1 - i;
         newData[index] *= (i / fadeSamples);
     }
  }

  return newBuffer;
}


// ---------------- MASTERING UTILS ----------------

export type MasteringPreset = 'music' | 'podcast' | 'narration';

export interface MasteringOptions {
  preset: MasteringPreset;
  enhanceLevel: number; // 0-1
  denoiseLevel: number; // 0-1
  sibilanceLevel: number; // 0-1 (De-esser)
  roomTreatmentLevel: number; // 0-1 (De-box/De-reverb simulation)
  reverbLevel?: number; // 0-1 (Add Echo/Space) - Optional
}

/**
 * Creates a synthetic Impulse Response for the ConvolverNode (Reverb)
 */
function createReverbImpulse(context: BaseAudioContext, duration: number = 2.0, decay: number = 2.0): AudioBuffer {
    const rate = context.sampleRate;
    const length = rate * duration;
    const impulse = context.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        // White noise
        const n = Math.random() * 2 - 1;
        // Exponential decay
        const envelope = Math.pow(1 - i / length, decay);
        
        left[i] = n * envelope;
        right[i] = n * envelope;
    }
    return impulse;
}

function createMasteringChain(context: BaseAudioContext, destination: AudioNode, options: MasteringOptions) {
  const { preset, enhanceLevel, denoiseLevel, sibilanceLevel, roomTreatmentLevel, reverbLevel = 0 } = options;
  
  const input = context.createGain();
  let current: AudioNode = input;
  
  // 1. Enhanced Denoise Logic (Gates/Filters)
  if (denoiseLevel > 0) {
      const highPass = context.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 70 + (denoiseLevel * 130); 
      highPass.Q.value = 0.6;
      current.connect(highPass);
      current = highPass;

      const highShelfHiss = context.createBiquadFilter();
      highShelfHiss.type = 'highshelf';
      highShelfHiss.frequency.value = 5000; 
      highShelfHiss.gain.value = -(Math.pow(denoiseLevel, 0.7) * 18);
      current.connect(highShelfHiss);
      current = highShelfHiss;

      if (denoiseLevel > 0.3) {
          const lowPass = context.createBiquadFilter();
          lowPass.type = 'lowpass';
          const t = (denoiseLevel - 0.3) / 0.7; 
          const cutFreq = 18000 - (t * 14000); 
          lowPass.frequency.value = Math.max(4000, cutFreq);
          lowPass.Q.value = 0.5;
          current.connect(lowPass);
          current = lowPass;
      }
  }

  // 2. Room Treatment (De-Box / Acoustic Fix / De-Reverb)
  // Simulates a treated room by removing boxy frequencies (300-500Hz) and tightening low-mids
  if (roomTreatmentLevel > 0) {
     const deBoxFilter = context.createBiquadFilter();
     deBoxFilter.type = 'peaking';
     deBoxFilter.frequency.value = 400; // Center of boxiness
     deBoxFilter.Q.value = 1.2;
     // Cut up to 12dB based on level
     deBoxFilter.gain.value = -(roomTreatmentLevel * 12); 
     
     current.connect(deBoxFilter);
     current = deBoxFilter;

     const mudFilter = context.createBiquadFilter();
     mudFilter.type = 'peaking';
     mudFilter.frequency.value = 200;
     mudFilter.Q.value = 1.0;
     mudFilter.gain.value = -(roomTreatmentLevel * 6);
     
     current.connect(mudFilter);
     current = mudFilter;
  }

  // 3. IMPROVED De-Esser (Sibilance Control)
  // Now uses a Dual-Stage approach: 
  // 1. Harsh notch at 7.5kHz
  // 2. Gentle shelf at 10kHz+
  if (sibilanceLevel > 0) {
      // Stage A: Target the sharp "S" sound
      const deEsserTarget = context.createBiquadFilter();
      deEsserTarget.type = 'peaking';
      deEsserTarget.frequency.value = 7500;
      deEsserTarget.Q.value = 2.5; 
      // More aggressive cut based on request (up to -24dB)
      deEsserTarget.gain.value = -(sibilanceLevel * 24); 
      
      current.connect(deEsserTarget);
      current = deEsserTarget;

      // Stage B: Soften the high end generally if sibilance is very high
      if (sibilanceLevel > 0.3) {
          const deEsserSoften = context.createBiquadFilter();
          deEsserSoften.type = 'highshelf';
          deEsserSoften.frequency.value = 10000;
          deEsserSoften.gain.value = -(sibilanceLevel * 6); // Subtle roll-off
          
          current.connect(deEsserSoften);
          current = deEsserSoften;
      }
  }
  
  // 4. Equalization (Tone Shaping)
  const lowShelf = context.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = 100;
  
  const highShelf = context.createBiquadFilter();
  highShelf.type = 'highshelf';
  highShelf.frequency.value = 8000;
  
  const midPeaking = context.createBiquadFilter();
  midPeaking.type = 'peaking';
  midPeaking.frequency.value = 2500;
  midPeaking.Q.value = 1.0;

  const boost = enhanceLevel * 6; 

  if (preset === 'music') {
      // ORCHESTRAL / MODERN NATURAL
      // 1. Sub-bass foundation (Deep & Controlled) - Lower freq, moderate gain
      lowShelf.frequency.value = 60; 
      lowShelf.gain.value = boost * 0.6; // Deep warmth without mid-bass mud

      // 2. Air/Openness (Agudos suaves e arejados) - High freq for "Air" not "Fizz"
      highShelf.frequency.value = 12000; 
      highShelf.gain.value = boost * 0.6; 

      // 3. Mids (Ricos em detalhes) 
      // Gentle cut in low-mids to unmask details, rather than scooping the presence
      midPeaking.frequency.value = 300;
      midPeaking.gain.value = -(boost * 0.2); // Very subtle un-mudding
      midPeaking.Q.value = 0.8;

  } else if (preset === 'podcast') {
      lowShelf.gain.value = boost * 0.5;
      highShelf.gain.value = boost * 0.5;
      midPeaking.gain.value = boost * 0.5; 
  } else if (preset === 'narration') {
      // WARMER NARRATION LOGIC
      // Increase low shelf frequency slightly to cover "chest" voice (around 120-140Hz)
      lowShelf.frequency.value = 120;
      // Boost lows significantly for warmth
      lowShelf.gain.value = boost * 1.6; 
      
      // Reduce highs to remove "digital" feel
      highShelf.gain.value = boost * 0.1;
      
      // Shift Mid down slightly and reduce gain for a smoother, less piercing body
      midPeaking.frequency.value = 2000;
      midPeaking.gain.value = boost * 0.6; 
  }
  
  current.connect(lowShelf);
  lowShelf.connect(highShelf);
  highShelf.connect(midPeaking);
  current = midPeaking;
  
  // 5. Dynamics (Compression)
  const compressor = context.createDynamicsCompressor();
  if (preset === 'music') {
      // Transparent, Gluelike Compression (Modern/Orchestral)
      compressor.threshold.value = -14; // Higher threshold preserves dynamics
      compressor.knee.value = 15;       // Soft knee
      compressor.ratio.value = 1.5 + (enhanceLevel * 1.5); // Low ratio (1.5:1 to 3:1)
      compressor.attack.value = 0.05;   // Slow attack (50ms) to preserve transients
      compressor.release.value = 0.2;   // Natural release
  } else {
      compressor.threshold.value = -18;
      compressor.knee.value = 10;
      compressor.ratio.value = 4 + (enhanceLevel * 12); 
      compressor.attack.value = 0.002;
      compressor.release.value = 0.15;
  }
  current.connect(compressor);
  current = compressor;
  
  // 6. Limiter / Makeup Gain
  const makeupGain = context.createGain();
  makeupGain.gain.value = 1 + (enhanceLevel * 0.6); 
  current.connect(makeupGain);
  
  // 7. NEW: Reverb / Echo (Parallel processing)
  if (reverbLevel > 0) {
      const convolver = context.createConvolver();
      // Generate a nice studio room impulse (1.5s duration)
      convolver.buffer = createReverbImpulse(context, 1.5, 3.0);
      
      const reverbGain = context.createGain();
      // Scale logarithmic-ish for better control
      reverbGain.gain.value = reverbLevel * 0.6; 

      // Connect Mix: Makeup -> Convolver -> ReverbGain -> Dest
      makeupGain.connect(convolver);
      convolver.connect(reverbGain);
      reverbGain.connect(destination);
  }

  // Dry signal always goes to destination
  makeupGain.connect(destination);
  
  return input;
}

export async function masterAudio(buffer: AudioBuffer, options: MasteringOptions): Promise<AudioBuffer> {
   const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
   
   const source = offlineCtx.createBufferSource();
   source.buffer = buffer;
   
   const chainInput = createMasteringChain(offlineCtx, offlineCtx.destination, options);
   source.connect(chainInput);
   
   source.start();
   return await offlineCtx.startRendering();
}

export function createPreviewPlayer(
    buffer: AudioBuffer, 
    options: MasteringOptions, 
    enabled: boolean, 
    offset: number,
    onEnded: () => void
): { stop: () => void, analyser: AnalyserNode, startTime: number } {
    const context = getAudioContext();
    const source = context.createBufferSource();
    source.buffer = buffer;
    
    // Create Analyser with faster smoothing for better visual sync
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048; // Increased from 256 for smooth curves
    analyser.smoothingTimeConstant = 0.8; // Smoother movement
    
    if (enabled) {
        // Chain: Source -> MasterChain -> Analyser -> Destination
        const chainInput = createMasteringChain(context, analyser, options);
        source.connect(chainInput);
    } else {
        // Chain: Source -> Analyser -> Destination
        source.connect(analyser);
    }
    
    analyser.connect(context.destination);
    
    source.onended = onEnded;
    
    // Safety check for offset
    const safeOffset = Math.min(offset, buffer.duration);
    
    // Precision Scheduling
    const startTime = context.currentTime + 0.01;
    source.start(startTime, safeOffset);
    
    return {
        stop: () => {
            source.onended = null;
            try { source.stop(); } catch(e) {}
            source.disconnect();
        },
        analyser,
        startTime // Return the exact scheduled start time
    };
}
