import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Download, Wand2, Mic, Music, Radio, Sliders, Zap, CheckCircle, Loader2, Scissors, Ear, MoveHorizontal, Volume1, Volume2 } from 'lucide-react';
import { audioBufferToMp3, audioBufferToWav, decodeAudioFile, masterAudio, createPreviewPlayer, MasteringPreset, getAudioContext, formatTime, trimAudio } from '../utils/audioUtils';
import Dropzone from './Dropzone';

const MasteringStudio: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewEffectEnabled, setPreviewEffectEnabled] = useState(true);
  
  // Settings
  const [preset, setPreset] = useState<MasteringPreset>('music');
  
  // Updated Defaults per user request
  const [enhanceLevel, setEnhanceLevel] = useState(0.7); // 70% Intensity
  const [denoiseLevel, setDenoiseLevel] = useState(0.1); // 10% Noise Reduction
  const [sibilanceLevel, setSibilanceLevel] = useState(0.3); // 30% De-Esser
  
  const [autoTrim, setAutoTrim] = useState(true);
  
  // Unified Echo Control: 0.0 (Dry) to 1.0 (Wet), 0.5 is Neutral
  const [echoControl, setEchoControl] = useState(0.5); 

  const [outputFormat, setOutputFormat] = useState<'mp3' | 'wav'>('mp3');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Playback Refs (Source of Truth)
  const playerRef = useRef<{ stop: () => void; analyser: AnalyserNode } | null>(null);
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);

  // UI State (Only for rendering, not logic)
  const [playbackProgress, setPlaybackProgress] = useState(0); // 0 to 1
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
  
  // Visuals refs
  const containerRef = useRef<HTMLDivElement>(null); // Main interaction container
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);

  // Helper to map single slider to audio engine params
  const getEchoParams = (val: number) => {
      let roomTreatmentLevel = 0;
      let reverbLevel = 0;

      // Dead zone in the middle (0.45 - 0.55) to ensure pure neutral
      if (val >= 0.48 && val <= 0.52) {
          return { roomTreatmentLevel: 0, reverbLevel: 0 };
      }

      if (val < 0.5) {
          // Going Left: Remove Reverb (Dry)
          // Map 0.5 -> 0.0 to Strength 0.0 -> 1.0
          roomTreatmentLevel = (0.5 - val) * 2;
      } else {
          // Going Right: Add Reverb (Wet)
          // Map 0.5 -> 1.0 to Strength 0.0 -> 1.0
          reverbLevel = (val - 0.5) * 2;
      }
      return { roomTreatmentLevel, reverbLevel };
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio(true);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // ANIMATION LOOP (CIRCULAR WAVE VISUALIZER)
  // ---------------------------------------------------------------------------
  const animate = () => {
    if (!audioBuffer) return;

    // 1. Calculate Real Time
    let currentPos = startOffsetRef.current; // Default to offset if paused
    
    if (isPlaying && playerRef.current) {
        const context = getAudioContext();
        const elapsed = context.currentTime - startTimeRef.current;
        currentPos = startOffsetRef.current + elapsed;
    }

    // Clamp values
    const duration = audioBuffer.duration;
    currentPos = Math.max(0, Math.min(currentPos, duration));
    const progressRatio = currentPos / duration;
    
    // Update UI directly
    setCurrentTimeDisplay(currentPos);
    setPlaybackProgress(progressRatio);

    // 2. Visualizer Drawing
    const canvas = canvasRef.current;
    const analyser = playerRef.current?.analyser;

    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const width = canvas.width;
            const height = canvas.height;
            const centerX = width / 2;
            const centerY = height / 2;
            
            // Base radius for the circular wave
            const baseRadius = 80;

            ctx.clearRect(0, 0, width, height);

            // If not playing, draw a subtle idle circle
            if (!analyser || !isPlaying) {
                ctx.beginPath();
                ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
                ctx.strokeStyle = '#3b82f6'; 
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.2;
                ctx.stroke();
                ctx.globalAlpha = 1;
                requestRef.current = requestAnimationFrame(animate);
                return;
            }

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            // Use TimeDomainData for the continuous "wave" look seen in the reference image
            analyser.getByteTimeDomainData(dataArray);

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Draw multiple overlapping layers to create the "mesh" effect
            const drawWaveLayer = (color: string, offsetIdx: number, amplitudeScale: number, rotation: number) => {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;

                const sliceAngle = (Math.PI * 2) / bufferLength;

                for (let i = 0; i <= bufferLength; i++) {
                     // Wrap around data
                     const index = (i + offsetIdx) % bufferLength;
                     
                     // dataArray is 0-255, 128 is center (silence)
                     const v = (dataArray[index] - 128) / 128.0; 
                     
                     // Radius oscillates based on waveform
                     const r = baseRadius + (v * 40 * amplitudeScale); // 40px max distortion

                     const theta = (i * sliceAngle) + rotation;
                     const x = centerX + Math.cos(theta) * r;
                     const y = centerY + Math.sin(theta) * r;

                     if (i === 0) ctx.moveTo(x, y);
                     else ctx.lineTo(x, y);
                }
                
                // Close the loop perfectly
                ctx.closePath();
                ctx.stroke();
            };

            // Glow Effect
            ctx.shadowBlur = 15;
            
            // Layer 1: Cyan/Teal (Main)
            ctx.shadowColor = '#06b6d4';
            drawWaveLayer('#06b6d4', 0, 1.2, 0);

            // Layer 2: Blue (Offset)
            ctx.shadowColor = '#3b82f6';
            drawWaveLayer('#3b82f6', 100, 1.0, 0.5); // Slight rotation and index offset

            // Layer 3: Indigo/Purple (Subtle)
            ctx.shadowColor = '#6366f1';
            drawWaveLayer('#6366f1', 200, 0.8, -0.5);

            // Reset glow
            ctx.shadowBlur = 0;
        }
    }

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [isPlaying, audioBuffer]);


  // ---------------------------------------------------------------------------
  // AUDIO CONTROL
  // ---------------------------------------------------------------------------

  const handleFileSelect = async (selectedFile: File) => {
    stopAudio(true);
    setIsProcessing(true);
    setFile(selectedFile);
    setDownloadUrl(null);
    try {
      const buffer = await decodeAudioFile(selectedFile);
      setAudioBuffer(buffer);
    } catch (e) {
      alert("Erro ao ler arquivo de áudio.");
    } finally {
      setIsProcessing(false);
    }
  };

  const stopAudio = (reset = true) => {
    if (playerRef.current) {
        const oldPlayer = playerRef.current;
        playerRef.current = null; 
        oldPlayer.stop(); 
    }

    setIsPlaying(false);
    
    if (reset) {
        startOffsetRef.current = 0;
        setCurrentTimeDisplay(0);
        setPlaybackProgress(0);
    }
  };

  const playAudio = (offset: number) => {
    if (!audioBuffer) return;

    if (playerRef.current) {
        const oldPlayer = playerRef.current;
        playerRef.current = null;
        oldPlayer.stop();
    }

    const { roomTreatmentLevel, reverbLevel } = getEchoParams(echoControl);

    const player = createPreviewPlayer(
      audioBuffer,
      { preset, enhanceLevel, denoiseLevel, sibilanceLevel, roomTreatmentLevel, reverbLevel },
      previewEffectEnabled,
      offset,
      () => {
        setIsPlaying(false);
        startOffsetRef.current = 0;
        setPlaybackProgress(0);
        setCurrentTimeDisplay(0);
        playerRef.current = null;
      }
    );
    
    playerRef.current = player;
    startTimeRef.current = player.startTime; 
    startOffsetRef.current = offset;         

    setIsPlaying(true);
  };

  const togglePlayback = (e?: React.MouseEvent) => {
    e?.stopPropagation(); 
    if (!audioBuffer) return;

    if (isPlaying) {
      const context = getAudioContext();
      const elapsed = context.currentTime - startTimeRef.current;
      const currentPos = Math.min(startOffsetRef.current + elapsed, audioBuffer.duration);
      
      startOffsetRef.current = currentPos;
      stopAudio(false); 
    } else {
      playAudio(startOffsetRef.current);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioBuffer || !containerRef.current) return;

    // Linear Seek Bar logic on a circular visualizer doesn't map visually 1:1,
    // so we keep the click behavior but maybe add a visual indicator later.
    // For now, clicking anywhere on the visualizer seeks based on X position 
    // relative to the container width, similar to before, to maintain usability.
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * audioBuffer.duration;

    startOffsetRef.current = newTime;
    setPlaybackProgress(percentage);
    setCurrentTimeDisplay(newTime);

    if (isPlaying) {
        playAudio(newTime);
    }
  };

  useEffect(() => {
    if (isPlaying && audioBuffer) {
       const context = getAudioContext();
       const elapsed = context.currentTime - startTimeRef.current;
       const currentPos = startOffsetRef.current + elapsed;
       playAudio(currentPos);
    }
  }, [preset, enhanceLevel, denoiseLevel, sibilanceLevel, echoControl, previewEffectEnabled]);


  const handleProcessAndDownload = async () => {
    if (!audioBuffer || !file) return;

    stopAudio(true);

    setIsProcessing(true);
    try {
      let bufferToMaster = audioBuffer;
      if (autoTrim) {
         bufferToMaster = trimAudio(bufferToMaster);
      }
      
      const { roomTreatmentLevel, reverbLevel } = getEchoParams(echoControl);

      const masteredBuffer = await masterAudio(bufferToMaster, {
        preset,
        enhanceLevel,
        denoiseLevel,
        sibilanceLevel,
        roomTreatmentLevel,
        reverbLevel
      });

      let blob: Blob;
      if (outputFormat === 'mp3') {
        blob = audioBufferToMp3(masteredBuffer);
      } else {
        blob = audioBufferToWav(masteredBuffer);
      }

      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);

    } catch (e) {
      console.error(e);
      alert("Erro ao processar masterização.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadClick = () => {
    if (downloadUrl && file) {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `SEBAS_MASTER_${file.name.replace(/\.[^/.]+$/, "")}.${outputFormat}`;
        a.click();
    }
  };

  const handleReset = () => {
    stopAudio(true);
    setFile(null);
    setAudioBuffer(null);
    setDownloadUrl(null);
  };

  const getEchoLabel = () => {
    if (echoControl >= 0.48 && echoControl <= 0.52) return "Neutro";
    if (echoControl < 0.5) return `Secando: ${Math.round((0.5 - echoControl) * 200)}%`;
    return `Adicionando: ${Math.round((echoControl - 0.5) * 200)}%`;
  };

  if (!file) {
    return (
      <div className="animate-in fade-in duration-300">
        <div className="bg-slate-900 text-white p-6 rounded-2xl mb-8 shadow-2xl">
            <h2 className="text-2xl font-bold flex items-center gap-2 mb-2">
                <Zap className="text-yellow-400 fill-yellow-400" />
                Sebas Master Pro
            </h2>
            <p className="text-slate-300">
                Estúdio de masterização digital. Remova ruídos, controle a ambiência (eco), ajuste a sibilância e maximize o volume automaticamente.
            </p>
        </div>
        <Dropzone onFileSelect={handleFileSelect} isProcessing={isProcessing} />
        <div className="mt-4 text-center text-sm text-slate-500">
             Suporta arquivos MP3, WAV e Stems (como arquivo único mixado).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full md:w-auto overflow-hidden">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
                <Music className="w-6 h-6" />
            </div>
            <div className="min-w-0">
                <h3 className="font-bold text-slate-900 truncate">{file.name}</h3>
                <p className="text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB • {outputFormat.toUpperCase()}</p>
            </div>
        </div>
        <button onClick={handleReset} className="text-slate-400 hover:text-red-500 text-sm font-medium transition-colors">
            Trocar Arquivo
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <div className="lg:col-span-4 space-y-4">
            
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Radio className="w-4 h-4" /> Estilo de Masterização
                </h4>
                <div className="space-y-2">
                    <button 
                        onClick={() => setPreset('music')}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${preset === 'music' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-600'}`}
                    >
                        <Music className="w-5 h-5" />
                        <div className="text-left">
                            <span className="block font-bold text-sm">Música</span>
                            <span className="text-xs opacity-70">Brilho, graves e coerência sonora</span>
                        </div>
                    </button>
                    <button 
                        onClick={() => setPreset('podcast')}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${preset === 'podcast' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-600'}`}
                    >
                        <Mic className="w-5 h-5" />
                        <div className="text-left">
                            <span className="block font-bold text-sm">Podcast</span>
                            <span className="text-xs opacity-70">Voz clara e volume constante</span>
                        </div>
                    </button>
                    <button 
                        onClick={() => setPreset('narration')}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${preset === 'narration' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-600'}`}
                    >
                        <Radio className="w-5 h-5" />
                        <div className="text-left">
                            <span className="block font-bold text-sm">Narração</span>
                            <span className="text-xs opacity-70">Voz quente, natural e presente</span>
                        </div>
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-6">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Sliders className="w-4 h-4" /> Ajustes Finos
                </h4>
                
                <div>
                    <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700">Intensidade (Magic)</label>
                        <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-1.5 rounded">{(enhanceLevel * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                        type="range" min="0" max="1" step="0.05"
                        value={enhanceLevel}
                        onChange={(e) => setEnhanceLevel(parseFloat(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                </div>

                {/* Unified Echo Control */}
                <div>
                    <div className="flex justify-between items-center mb-3">
                        <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                            <MoveHorizontal className="w-3.5 h-3.5 text-indigo-500" /> Controle de Ambiência
                        </label>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${Math.abs(echoControl - 0.5) < 0.02 ? 'bg-slate-100 text-slate-600' : 'bg-indigo-100 text-indigo-700'}`}>
                            {getEchoLabel()}
                        </span>
                    </div>
                    
                    <div className="relative h-8 w-full flex items-center justify-center">
                        {/* Custom Track */}
                        <div className="absolute left-0 right-0 h-2 bg-slate-100 rounded-full overflow-hidden pointer-events-none">
                             {/* Dry Side Gradient */}
                             <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-gradient-to-r from-purple-500/50 to-transparent"></div>
                             {/* Wet Side Gradient */}
                             <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-indigo-500/50 to-transparent"></div>
                             {/* Center Marker */}
                             <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-300 -translate-x-1/2"></div>
                        </div>

                        {/* Input with strict no-track styling to fix overlay bug */}
                        <input 
                            type="range" min="0" max="1" step="0.01"
                            value={echoControl}
                            onChange={(e) => setEchoControl(parseFloat(e.target.value))}
                            className="
                                absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer z-10 focus:outline-none
                                [&::-webkit-slider-runnable-track]:bg-transparent
                                [&::-webkit-slider-runnable-track]:appearance-none
                                [&::-moz-range-track]:bg-transparent
                                [&::-moz-range-track]:appearance-none
                                
                                [&::-webkit-slider-thumb]:appearance-none
                                [&::-webkit-slider-thumb]:w-4
                                [&::-webkit-slider-thumb]:h-4
                                [&::-webkit-slider-thumb]:rounded-full
                                [&::-webkit-slider-thumb]:bg-slate-800
                                [&::-webkit-slider-thumb]:shadow-md
                                [&::-webkit-slider-thumb]:border-2
                                [&::-webkit-slider-thumb]:border-white
                                [&::-webkit-slider-thumb]:hover:scale-110
                                [&::-webkit-slider-thumb]:transition-transform
                                
                                [&::-moz-range-thumb]:w-4
                                [&::-moz-range-thumb]:h-4
                                [&::-moz-range-thumb]:border-none
                                [&::-moz-range-thumb]:rounded-full
                                [&::-moz-range-thumb]:bg-slate-800
                            "
                        />
                        
                        <div className="absolute -bottom-4 left-0 right-0 flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-wider pointer-events-none">
                            <span className="flex items-center gap-1"><Volume1 className="w-3 h-3" /> Mais Seco</span>
                            <span className="flex items-center gap-1">Mais Eco <Volume2 className="w-3 h-3" /></span>
                        </div>
                    </div>
                </div>

                <div className="pt-2">
                    <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                            <Ear className="w-3.5 h-3.5" /> De-Esser (Sibilância)
                        </label>
                        <span className="text-xs font-mono bg-orange-100 text-orange-700 px-1.5 rounded">{(sibilanceLevel * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                        type="range" min="0" max="1" step="0.05"
                        value={sibilanceLevel}
                        onChange={(e) => setSibilanceLevel(parseFloat(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Suavização de sons agudos ("S", "T").</p>
                </div>

                <div>
                    <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700">Redução de Ruído</label>
                        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 rounded">{(denoiseLevel * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                        type="range" min="0" max="1" step="0.05"
                        value={denoiseLevel}
                        onChange={(e) => setDenoiseLevel(parseFloat(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-500"
                    />
                </div>

                 <div className="border-t border-slate-100 pt-4 mt-2">
                     <label className="text-sm font-medium text-slate-700 block mb-2">Opções de Saída</label>
                     <div className="flex items-center justify-between bg-slate-100 p-2 rounded-lg mb-3">
                         <div className="flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-slate-500" />
                            <span className="text-xs font-medium text-slate-600">Cortar Silêncio (Inicio/Fim)</span>
                         </div>
                         <button 
                            onClick={() => setAutoTrim(!autoTrim)}
                            className={`w-10 h-5 rounded-full relative transition-colors ${autoTrim ? 'bg-indigo-600' : 'bg-slate-300'}`}
                         >
                            <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-transform ${autoTrim ? 'left-6' : 'left-1'}`}></div>
                         </button>
                     </div>
                     <div className="flex bg-slate-100 p-1 rounded-lg">
                         <button onClick={() => setOutputFormat('mp3')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${outputFormat === 'mp3' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>MP3</button>
                         <button onClick={() => setOutputFormat('wav')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${outputFormat === 'wav' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>WAV</button>
                    </div>
                </div>
            </div>
        </div>

        {/* Action Panel */}
        <div className="lg:col-span-8 flex flex-col gap-6">
            
            <div 
                ref={containerRef}
                onClick={handleSeek}
                className="bg-slate-900 rounded-2xl h-80 relative flex flex-col items-center justify-between overflow-hidden shadow-inner group cursor-pointer"
            >
                {/* Deep background for visualizer */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-950 to-black z-0 pointer-events-none"></div>
                
                <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
                    <canvas 
                        ref={canvasRef} 
                        width={800} 
                        height={320} 
                        className="w-full h-full opacity-90"
                    />
                </div>

                {!isPlaying && !currentTimeDisplay && (
                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 z-0">
                      <Wand2 className="w-24 h-24 text-slate-700" />
                   </div>
                )}

                <div className="flex-1 flex items-center justify-center z-20 w-full gap-4 mt-32">
                     {(isPlaying || currentTimeDisplay > 0) && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); stopAudio(true); }}
                            className="w-12 h-12 bg-red-500/20 backdrop-blur-sm border border-red-500/30 rounded-full flex items-center justify-center text-red-100 hover:scale-110 hover:bg-red-500/40 transition-all shadow-xl"
                            title="Parar e Reiniciar"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                     )}

                     <button 
                        onClick={togglePlayback}
                        className="w-16 h-16 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full flex items-center justify-center text-white hover:scale-110 hover:bg-white/20 transition-all shadow-2xl"
                     >
                        {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                     </button>
                </div>

                <div className="absolute bottom-4 left-6 z-30 pointer-events-none">
                     <span className="text-xs font-mono font-bold text-indigo-400 bg-slate-900/50 px-2 py-1 rounded backdrop-blur-md">
                        {formatTime(currentTimeDisplay)}
                     </span>
                </div>
                <div className="absolute bottom-4 right-6 z-30 pointer-events-none">
                     <span className="text-xs font-mono text-slate-600">
                        {audioBuffer ? formatTime(audioBuffer.duration) : "0:00"}
                     </span>
                </div>

                <div className="absolute top-6 right-6 z-20" onClick={(e) => e.stopPropagation()}>
                    <button 
                        onClick={() => setPreviewEffectEnabled(!previewEffectEnabled)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors backdrop-blur-sm ${previewEffectEnabled ? 'bg-green-500/20 text-green-400 border border-green-500/50' : 'bg-red-500/20 text-red-400 border border-red-500/50'}`}
                    >
                        {previewEffectEnabled ? 'Effect ON' : 'Original'}
                    </button>
                </div>
            </div>

            <div className="bg-indigo-50 rounded-2xl p-6 border border-indigo-100 flex flex-col items-center justify-center text-center space-y-4">
                 
                 {!downloadUrl ? (
                    <>
                        <h3 className="text-lg font-bold text-indigo-900">Pronto para masterizar?</h3>
                        <p className="text-indigo-700/80 max-w-md text-sm">
                            O processo pode levar alguns segundos. O áudio será processado localmente em alta fidelidade.
                        </p>
                        <button 
                            onClick={handleProcessAndDownload}
                            disabled={isProcessing}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed w-full sm:w-auto justify-center"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Processando Master...
                                </>
                            ) : (
                                <>
                                    <Zap className="w-5 h-5" />
                                    Masterizar e Baixar
                                </>
                            )}
                        </button>
                    </>
                 ) : (
                    <div className="animate-in zoom-in duration-300 w-full">
                         <div className="mb-4 flex flex-col items-center">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                                <CheckCircle className="w-8 h-8 text-green-600" />
                            </div>
                            <h3 className="text-xl font-bold text-green-900">Sucesso!</h3>
                            <p className="text-green-700">Seu áudio está masterizado.</p>
                         </div>
                         <button 
                            onClick={handleDownloadClick}
                            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg shadow-green-200 transition-all flex items-center justify-center gap-3"
                         >
                            <Download className="w-5 h-5" />
                            Baixar Arquivo Final
                         </button>
                         <button 
                             onClick={() => setDownloadUrl(null)} 
                             className="mt-4 text-sm text-slate-500 hover:text-indigo-600 underline"
                         >
                            Fazer novo ajuste
                         </button>
                    </div>
                 )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default MasteringStudio;