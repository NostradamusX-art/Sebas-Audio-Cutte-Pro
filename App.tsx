import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { Scissors, Download, RefreshCw, Music, Link as LinkIcon, CheckCircle, ExternalLink, Clock } from 'lucide-react';
import Dropzone from './components/Dropzone';
import SegmentList, { Segment } from './components/SegmentList';
import { decodeAudioFile, sliceAudioBuffer, audioBufferToWav } from './utils/audioUtils';

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadLink, setDownloadLink] = useState<{ url: string; name: string } | null>(null);
  const [segmentDuration, setSegmentDuration] = useState<number>(10);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Cleanup audio object URLs to prevent memory leaks
    return () => {
      // Clean up previous blob URLs if resetting entirely
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

    try {
      // 1. Decode Audio
      const audioBuffer = await decodeAudioFile(selectedFile);

      // 2. Slice Audio
      const slicedBuffers = sliceAudioBuffer(audioBuffer, segmentDuration);

      // 3. Convert to WAV blobs
      setTimeout(async () => {
        try {
          const generatedSegments: Segment[] = slicedBuffers.map((buffer, index) => {
            const blob = audioBufferToWav(buffer);
            const startTime = index * segmentDuration;
            const endTime = Math.min(startTime + segmentDuration, audioBuffer.duration);
            
            // Clean filename
            const originalName = selectedFile.name.replace(/\.[^/.]+$/, "");
            const fileName = `${originalName}_part${(index + 1).toString().padStart(3, '0')}.wav`;

            return {
              id: index,
              blob,
              startTime,
              endTime,
              fileName
            };
          });

          setSegments(generatedSegments);

          // 4. Generate ZIP Link immediately
          const zip = new JSZip();
          const folderName = selectedFile.name.replace(/\.[^/.]+$/, "") + `_${segmentDuration}s_parts`;
          const folder = zip.folder(folderName);

          if (folder) {
            generatedSegments.forEach(seg => {
              folder.file(seg.fileName, seg.blob);
            });
            const content = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(content);
            setDownloadLink({
              url,
              name: `${folderName}.zip`
            });
          }

          setIsProcessing(false);
        } catch (err) {
          console.error("Error encoding/zipping:", err);
          setError("Erro ao processar áudio. O arquivo pode ser muito grande ou corrompido.");
          setIsProcessing(false);
        }
      }, 100);

    } catch (err) {
      console.error("Error decoding audio:", err);
      setError("Não foi possível ler o arquivo de áudio. Verifique se o formato é suportado.");
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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-5">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button 
              onClick={handleReset}
              className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-200 cursor-pointer hover:bg-indigo-700 hover:scale-105 transition-all duration-200"
              title="Voltar ao início"
            >
              <Scissors className="w-8 h-8 text-white" />
            </button>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight text-center">
              Sebas Audio Cutter <span className="text-indigo-600">Pro</span>
            </h1>
          </div>
          
          <div className="text-slate-600 max-w-2xl mx-auto space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-800">
              Liberte a sua produtividade: O corte de áudio nunca mais será o mesmo!
            </h2>
            <p className="text-sm sm:text-base leading-relaxed">
              Apresentamos o melhor e mais prático cortador de áudio automático do mercado. Elimine o trabalho manual e ganhe tempo na sua produção, aproveitando ferramentas que utilizam IA para otimizar o fluxo de trabalho.
            </p>
            <p className="text-sm sm:text-base bg-white/50 p-4 rounded-lg border border-slate-100 shadow-sm">
              Com esta solução, você pode dividir suas faixas em partes sequenciais e perfeitamente sincronizadas com a precisão de <strong>6, 8, 10, 12 ou 15 segundos</strong>.
              <br className="mb-2 block sm:hidden" /> 
              Baixe todos os clipes gerados de uma só vez, transformando o demorado processo de edição em uma tarefa de um clique.
            </p>
          </div>
        </div>

        {/* Main Content Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          <div className="p-6 sm:p-8 space-y-6">
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            {/* Upload or Results */}
            {!file || (segments.length === 0 && isProcessing) ? (
              <div className="space-y-6">
                 
                 {/* Duration Selector */}
                 <div className="flex flex-col items-center gap-3 animate-in fade-in zoom-in duration-300">
                    <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-indigo-500" />
                        Escolha o tempo de corte:
                    </label>
                    <div className="flex flex-wrap justify-center items-center gap-2 p-2 bg-slate-100 rounded-xl border border-slate-200 shadow-inner">
                        {[6, 8, 10, 12, 15].map((s) => (
                            <button
                                key={s}
                                onClick={() => setSegmentDuration(s)}
                                disabled={isProcessing}
                                className={`
                                    px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200
                                    ${segmentDuration === s 
                                        ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5 scale-100' 
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 scale-95'
                                    }
                                `}
                            >
                                {s}s
                            </button>
                        ))}
                    </div>
                 </div>

                 <Dropzone onFileSelect={handleFileSelect} isProcessing={isProcessing} />
                 
                 {isProcessing && (
                   <div className="space-y-2">
                     <div className="flex justify-between text-xs text-slate-500 px-1">
                       <span>Processando áudio...</span>
                       <span>Por favor aguarde</span>
                     </div>
                     <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                       <div className="bg-indigo-600 h-full rounded-full animate-progress-indeterminate"></div>
                     </div>
                   </div>
                 )}
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Success / Download Link Section */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-3 text-green-800">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                      <LinkIcon className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Seu link de download está pronto!</h3>
                      <p className="text-sm text-green-700 opacity-90">
                        {segments.length} partes de {segmentDuration}s geradas.
                      </p>
                    </div>
                  </div>
                  
                  {downloadLink && (
                    <button
                      onClick={triggerDownload}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-5 rounded-lg transition-colors shadow-sm"
                    >
                      <Download className="w-4 h-4" />
                      Baixar {downloadLink.name}
                    </button>
                  )}
                </div>

                {/* File Info Bar */}
                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                      <Music className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate pr-4">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB • {segments.length} partes
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={handleReset}
                    className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
                    title="Começar de novo"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Novo
                  </button>
                </div>

                {/* List */}
                <div className="border-t border-slate-100 pt-6">
                  <SegmentList 
                    segments={segments}
                    currentlyPlayingId={currentlyPlayingId}
                    onPlay={handlePlay}
                    onPause={handlePause}
                  />
                </div>

              </div>
            )}

          </div>
          
          {/* Footer of Card */}
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
             <span>Processamento 100% local no navegador.</span>
             <a href="#" className="flex items-center gap-1 hover:text-indigo-600 transition-colors">
               <ExternalLink className="w-3 h-3" />
               Termos de uso
             </a>
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;