import React, { useRef, useState } from 'react';
import { Upload, Music, Loader2 } from 'lucide-react';

interface DropzoneProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

const Dropzone: React.FC<DropzoneProps> = ({ onFileSelect, isProcessing }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Expanded list of accepted formats to help mobile OS recognition
  const acceptedFormats = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma";

  const isValidAudioFile = (file: File) => {
    // Check by MIME type
    if (file.type && file.type.startsWith('audio/')) return true;
    
    // Fallback: check by extension (crucial for some mobile browsers)
    const extension = file.name.split('.').pop()?.toLowerCase();
    const commonAudioExtensions = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'm4r'];
    if (extension && commonAudioExtensions.includes(extension)) return true;
    
    return false;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (isValidAudioFile(file)) {
        onFileSelect(file);
      } else {
        alert('Por favor, carregue apenas arquivos de áudio (MP3, WAV, etc).');
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (isValidAudioFile(file)) {
        onFileSelect(file);
      } else {
        alert('Arquivo não reconhecido como áudio. Tente um formato comum como MP3 ou WAV.');
      }
    }
  };

  return (
    <div
      onClick={() => !isProcessing && inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer
        ${isDragOver 
          ? 'border-indigo-500 bg-indigo-50/50 scale-[1.02]' 
          : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50'
        }
        ${isProcessing ? 'pointer-events-none opacity-80' : ''}
        flex flex-col items-center justify-center text-center 
        h-56 sm:h-72 p-6 sm:p-12
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptedFormats}
        className="hidden"
        onChange={handleChange}
        disabled={isProcessing}
      />
      
      <div className="z-10 flex flex-col items-center gap-3 sm:gap-4">
        <div className={`
          p-3 sm:p-4 rounded-full transition-colors duration-300
          ${isDragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}
        `}>
          {isProcessing ? (
            <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin" />
          ) : (
            <Upload className="w-6 h-6 sm:w-8 sm:h-8" />
          )}
        </div>
        
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-slate-900">
            {isProcessing ? 'Processando áudio...' : 'Carregar arquivo de música'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-xs mx-auto">
            {isProcessing 
              ? 'Isso pode levar alguns segundos dependendo do tamanho.' 
              : 'Clique aqui ou arraste seu MP3/WAV'
            }
          </p>
        </div>
      </div>

      {/* Background decoration */}
      <Music className="absolute -bottom-6 -right-6 sm:-bottom-8 sm:-right-8 w-28 h-28 sm:w-40 sm:h-40 text-slate-100 -rotate-12 pointer-events-none" />
    </div>
  );
};

export default Dropzone;