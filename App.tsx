import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { Scissors, Download, RefreshCw, Music, Link as LinkIcon, CheckCircle, ExternalLink, Clock, Wand2, Timer, Settings2, FileAudio, Layers, ChevronRight, Zap, Grip, Mic2 } from 'lucide-react';
import Dropzone from './components/Dropzone';
import SegmentList, { Segment } from './components/SegmentList';
import MasteringStudio from './components/MasteringStudio';
import { decodeAudioFile, sliceAudioBuffer, audioBufferToWav, audioBufferToMp3, removeSilence, mergeBuffers } from './utils/audioUtils';

type AppMode = 'cut' | 'silence';
type AudioFormat = 'wav' | 'mp3';
type SilenceOutputType = 'individual' | 'merged';
type Tab = 'cutter' | 'master';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('master'); 

  // --- CUTTER LOGIC (Legacy) ---
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadLink, setDownloadLink] = useState<{ url: string; name: string } | null>(null);
  
  // Settings
  const [mode, setMode] = useState<AppMode>('cut');
  const [segmentDuration, setSegmentDuration] = useState<number>(10);
  const [outputFormat, setOutputFormat] = useState<AudioFormat>('mp3');
  const [silenceOutputType, setSilenceOutputType] = useState<SilenceOutputType>('merged');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (downloadLink) {
        URL.revokeObjectURL(downloadLink.url);
      }
    };
  }, [downloadLink]);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setSegments([]);
    setDownloadLink(null);
    setCurrentlyPlayingId(null);
    setIsProcessing(true);
    setProcessingStage("Carregando e decodificando...");

    try {
      let audioBuffer = await decodeAudioFile(selectedFile);
      let bufferList: AudioBuffer[] = [];

      if (mode === 'silence') {
        setProcessingStage("Analisando vocais e removendo silêncio...");
        bufferList = await removeSilence(audioBuffer);
        
        if (silenceOutputType === 'merged' && bufferList.length > 0) {
           setProcessingStage("Unindo partes...");
           const merged = mergeBuffers(bufferList);
           bufferList = [merged];
        }

      } else {
        setProcessingStage("Cortando arquivos...");
        bufferList = sliceAudioBuffer(audioBuffer, segmentDuration);
      }

      if (bufferList.length === 0) {
        throw new Error("O áudio resultante está vazio. Tente ajustar as configurações.");
      }

      setProcessingStage(`Convertendo para ${outputFormat.toUpperCase()}...`);
      
      setTimeout(async () => {
        try {
          const generatedSegments: Segment[] = [];
          const originalName = selectedFile.name.replace(/\.[^/.]+$/, "");
          const ext = outputFormat;

          for (let i = 0; i < bufferList.length; i++) {
             const buffer = bufferList[i];
             let blob: Blob;

             if (outputFormat === 'mp3') {
               blob = audioBufferToMp3(buffer);
             } else {
               blob = audioBufferToWav(buffer);
             }

             let fileName = "";
             let startTime = 0;
             let endTime = buffer.duration;

             if (mode === 'silence') {
                if (silenceOutputType === 'merged') {
                    fileName = `${originalName}_vocal_clean.${ext}`;
                } else {
                    fileName = `${originalName}_part${(i + 1).toString().padStart(3, '0')}.${ext}`;
                }
             } else {
                startTime = i * segmentDuration;
                endTime = Math.min(startTime + segmentDuration, audioBuffer.duration); 
                fileName = `${originalName}_part${(i + 1).toString().padStart(3, '0')}.${ext}`;
             }

             generatedSegments.push({
               id: i,
               blob,
               startTime,
               endTime,
               fileName
             });
          }

          setSegments(generatedSegments);
          setProcessingStage("Gerando link de download...");
          
          let finalDownloadUrl = "";
          let finalDownloadName = "";

          if (generatedSegments.length === 1) {
            finalDownloadUrl = URL.createObjectURL(generatedSegments[0].blob);
            finalDownloadName = generatedSegments[0].fileName;
          } else {
            const zip = new JSZip();
            let folderName = "";
            
            if (mode === 'silence') {
              folderName = `${originalName}_cleaned_parts`;
            } else {
              folderName = `${originalName}_${segmentDuration}s_parts`;
            }

            const folder = zip.folder(folderName);

            if (folder) {
              generatedSegments.forEach(seg => {
                folder.file(seg.fileName, seg.blob);
              });
              const content = await zip.generateAsync({ type: "blob" });
              finalDownloadUrl = URL.createObjectURL(content);
              finalDownloadName = `${folderName}.zip`;
            }
          }

          if (finalDownloadUrl) {
              setDownloadLink({
                url: finalDownloadUrl,
                name: finalDownloadName
              });
          }

          setIsProcessing(false);
          setProcessingStage("");
        } catch (err) {
          console.error("Error encoding/zipping:", err);
          setError("Erro ao processar áudio. Tente usar WAV se o arquivo for muito longo.");
          setIsProcessing(false);
        }
      }, 100);

    } catch (err) {
      console.error("Error decoding audio:", err);
      setError("Não foi possível processar o arquivo. Verifique o formato.");
      setIsProcessing(false);
    }
  };

  const handlePlay = (id: number) => {
    const segment = segments.find(s => s.id === id);
    if (!segment) return;

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(URL.createObjectURL(segment.blob));
    audioRef.current = audio;
    
    audio.play();
    setCurrentlyPlayingId(id);
    
    audio.onended = () => {
      setCurrentlyPlayingId(null);
    };
    
    audio.onerror = () => {
      setError("Erro ao reproduzir o segmento.");
      setCurrentlyPlayingId(null);
    };
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setCurrentlyPlayingId(null);
  };

  const triggerDownload = () => {
    if (downloadLink) {
      FileSaver.saveAs(downloadLink.url, downloadLink.name);
    }
  };

  const handleReset = () => {
    setFile(null);
    setSegments([]);
    setDownloadLink(null);
    setCurrentlyPlayingId(null);
    setError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-6xl space-y-8 sm:space-y-10">
        
        {/* Header & Navigation */}
        <div className="text-center space-y-4 sm:space-y-5">
           <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight text-center leading-tight mb-8">
              Sebas Audio <span className="text-indigo-600">Studio Pro</span>
           </h1>

           {/* Tabs */}
           <div className="flex justify-center mb-8">
             <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 inline-flex gap-2">
                <button
                  onClick={() => setActiveTab('cutter')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${activeTab === 'cutter' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <Scissors className="w-4 h-4" />
                  Cutter Pro
                </button>
                <button
                  onClick={() => setActiveTab('master')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${activeTab === 'master' ? 'bg-slate-900 text-yellow-400 shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <Zap className="w-4 h-4" />
                  Master Pro
                </button>
             </div>
           </div>
        </div>

        {/* --- TAB CONTENT: MASTER --- */}
        {activeTab === 'master' && (
           <MasteringStudio />
        )}

        {/* --- TAB CONTENT: CUTTER --- */}
        {activeTab === 'cutter' && (
          <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden border border-slate-100 animate-in fade-in">
            <div className="p-4 sm:p-8 lg:p-10 space-y-6">
              
              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              {!file || (segments.length === 0 && isProcessing) ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                   
                   <div className="lg:col-span-4 flex flex-col gap-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider hidden lg:block mb-2">
                          1. Selecione o Modo
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 sm:gap-4 h-full">
                          <button
                              onClick={() => setMode('cut')}
                              disabled={isProcessing}
                              className={`
                                  relative flex flex-row lg:flex-col items-center lg:items-start gap-4 p-5 lg:p-6 rounded-2xl border-2 transition-all duration-200 text-left
                                  ${mode === 'cut'
                                      ? 'border-indigo-500 bg-indigo-50/50 text-indigo-700 ring-1 ring-indigo-500 shadow-md'
                                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                  }
                              `}
                          >
                              <div className={`p-3 rounded-full ${mode === 'cut' ? 'bg-indigo-200/50' : 'bg-slate-100'}`}>
                                  <Timer className={`w-6 h-6 lg:w-8 lg:h-8 shrink-0 ${mode === 'cut' ? 'text-indigo-700' : 'text-slate-400'}`} />
                              </div>
                              <div>
                                  <span className="block font-bold text-lg lg:text-xl mb-1">Corte Sequencial</span>
                                  <span className="text-xs lg:text-sm opacity-80 leading-relaxed block">
                                      Divida o áudio em partes exatas (ex: 10s) para slides ou stories.
                                  </span>
                              </div>
                              {mode === 'cut' && <div className="absolute top-4 right-4 hidden lg:block"><ChevronRight className="w-5 h-5 text-indigo-400" /></div>}
                          </button>

                          <button
                              onClick={() => setMode('silence')}
                              disabled={isProcessing}
                              className={`
                                  relative flex flex-row lg:flex-col items-center lg:items-start gap-4 p-5 lg:p-6 rounded-2xl border-2 transition-all duration-200 text-left
                                  ${mode === 'silence'
                                      ? 'border-indigo-500 bg-indigo-50/50 text-indigo-700 ring-1 ring-indigo-500 shadow-md'
                                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                  }
                              `}
                          >
                              <div className={`p-3 rounded-full ${mode === 'silence' ? 'bg-indigo-200/50' : 'bg-slate-100'}`}>
                                  <Wand2 className={`w-6 h-6 lg:w-8 lg:h-8 shrink-0 ${mode === 'silence' ? 'text-indigo-700' : 'text-slate-400'}`} />
                              </div>
                              <div>
                                  <span className="block font-bold text-lg lg:text-xl mb-1">Smart Silence</span>
                                  <span className="text-xs lg:text-sm opacity-80 leading-relaxed block">
                                      IA remove silêncios e preserva apenas a voz humana.
                                  </span>
                              </div>
                              {mode === 'silence' && <div className="absolute top-4 right-4 hidden lg:block"><ChevronRight className="w-5 h-5 text-indigo-400" /></div>}
                          </button>
                      </div>
                   </div>

                   <div className="lg:col-span-8 flex flex-col gap-6">
                      
                      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 space-y-4">
                          <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm border-b border-slate-200 pb-2 mb-3">
                              <Settings2 className="w-4 h-4" />
                              <span className="uppercase tracking-wider">2. Configurações</span>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-6 lg:gap-8 justify-start items-start">
                              <div className="flex flex-col gap-2 w-full sm:w-auto">
                                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Formato</label>
                                  <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm w-full sm:w-fit">
                                      <button
                                          onClick={() => setOutputFormat('mp3')}
                                          className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium transition-all ${outputFormat === 'mp3' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                                      >
                                          MP3
                                      </button>
                                      <button
                                          onClick={() => setOutputFormat('wav')}
                                          className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium transition-all ${outputFormat === 'wav' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                                      >
                                          WAV
                                      </button>
                                  </div>
                              </div>

                              {mode === 'cut' && (
                                  <div className="flex flex-col gap-2 w-full sm:w-auto animate-in fade-in">
                                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Duração do Corte</label>
                                      <div className="grid grid-cols-5 sm:flex sm:flex-wrap gap-2">
                                          {[6, 8, 10, 12, 15].map((s) => (
                                              <button
                                                  key={s}
                                                  onClick={() => setSegmentDuration(s)}
                                                  className={`
                                                      w-full sm:w-10 h-9 sm:h-9 flex items-center justify-center rounded-md text-xs sm:text-sm font-bold border transition-all
                                                      ${segmentDuration === s 
                                                          ? 'bg-white border-indigo-500 text-indigo-600 shadow-sm ring-1 ring-indigo-500' 
                                                          : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'
                                                      }
                                                  `}
                                              >
                                                  {s}s
                                              </button>
                                          ))}
                                      </div>
                                  </div>
                              )}

                              {mode === 'silence' && (
                                  <div className="flex flex-col gap-2 w-full sm:w-auto animate-in fade-in">
                                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo de Saída</label>
                                      <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
                                          <button
                                              onClick={() => setSilenceOutputType('merged')}
                                              className={`flex items-center justify-center sm:justify-start gap-2 px-3 py-2 rounded-md text-sm font-medium border transition-all ${silenceOutputType === 'merged' ? 'bg-white border-indigo-500 text-indigo-600 ring-1 ring-indigo-500' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200'}`}
                                          >
                                              <Layers className="w-4 h-4" /> Áudio Inteiro
                                          </button>
                                          <button
                                              onClick={() => setSilenceOutputType('individual')}
                                              className={`flex items-center justify-center sm:justify-start gap-2 px-3 py-2 rounded-md text-sm font-medium border transition-all ${silenceOutputType === 'individual' ? 'bg-white border-indigo-500 text-indigo-600 ring-1 ring-indigo-500' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200'}`}
                                          >
                                              <FileAudio className="w-4 h-4" /> Partes Separadas
                                          </button>
                                      </div>
                                  </div>
                              )}
                          </div>
                      </div>

                      <div className="relative">
                          <Dropzone onFileSelect={handleFileSelect} isProcessing={isProcessing} />
                          
                          {isProcessing && (
                          <div className="absolute inset-x-0 -bottom-8 space-y-2">
                              <div className="flex justify-between text-xs text-slate-500 px-1 font-medium">
                              <span>{processingStage}</span>
                              <span>Aguarde...</span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                              <div className="bg-indigo-600 h-full rounded-full animate-progress-indeterminate"></div>
                              </div>
                          </div>
                          )}
                      </div>
                   </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  
                  <div className="lg:col-span-5 space-y-6">
                      <div className="bg-green-50 border border-green-200 rounded-2xl p-6 lg:p-8 flex flex-col items-center text-center shadow-sm gap-4">
                          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center shrink-0 mb-2">
                              <LinkIcon className="w-8 h-8 text-green-600" />
                          </div>
                          <div>
                              <h3 className="text-xl font-bold text-green-900">Download Pronto!</h3>
                              <p className="text-green-700 opacity-90 mt-1">
                                  {mode === 'silence' 
                                      ? (silenceOutputType === 'merged' ? 'Áudio otimizado e unido.' : `${segments.length} partes otimizadas.`) 
                                      : `${segments.length} partes de ${segmentDuration}s geradas.`
                                  }
                              </p>
                          </div>
                          
                          {downloadLink && (
                              <button
                              onClick={triggerDownload}
                              className="w-full mt-2 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                              >
                              <Download className="w-5 h-5" />
                              Baixar {downloadLink.name}
                              </button>
                          )}
                      </div>

                      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
                          <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Arquivo Original</h4>
                          <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                                  <Music className="w-6 h-6 text-indigo-600" />
                              </div>
                              <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-slate-900 truncate" title={file.name}>
                                      {file.name}
                                  </p>
                                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                                      <span className="uppercase font-bold bg-slate-200 px-2 py-0.5 rounded text-slate-700">{outputFormat}</span>
                                      <span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                  </div>
                              </div>
                          </div>

                          <button 
                              onClick={handleReset}
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors text-sm font-medium border border-slate-200 hover:border-red-200 dashed"
                          >
                              <RefreshCw className="w-4 h-4" />
                              Processar novo arquivo
                          </button>
                      </div>
                  </div>

                  <div className="lg:col-span-7 border-t lg:border-t-0 lg:border-l border-slate-100 lg:pl-8 pt-6 lg:pt-0">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                       <FileAudio className="w-5 h-5 text-indigo-600" />
                       Lista de Partes ({segments.length})
                    </h3>
                    <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-1">
                        <SegmentList 
                          segments={segments}
                          currentlyPlayingId={currentlyPlayingId}
                          onPlay={handlePlay}
                          onPause={handlePause}
                        />
                    </div>
                  </div>

                </div>
              )}

            </div>
            
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2 text-center sm:text-left">
               <span>Processamento 100% local no navegador.</span>
               <a href="#" className="flex items-center gap-1 hover:text-indigo-600 transition-colors">
                 <ExternalLink className="w-3 h-3" />
                 Termos de uso
               </a>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default App;