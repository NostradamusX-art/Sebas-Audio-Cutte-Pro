import React, { useRef, useState } from 'react';
import { Upload, Music, Loader2 } from 'lucide-react';

interface DropzoneProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

const Dropzone: React.FC<DropzoneProps> = ({ onFileSelect, isProcessing }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (file.type.startsWith('audio/')) {
        onFileSelect(file);
      } else {
        alert('Por favor, carregue apenas arquivos de áudio.');
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
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
        flex flex-col items-center justify-center p-12 text-center h-64
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleChange}
        disabled={isProcessing}
      />
      
      <div className="z-10 flex flex-col items-center gap-4">
        <div className={`
          p-4 rounded-full transition-colors duration-300
          ${isDragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}
        `}>
          {isProcessing ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : (
            <Upload className="w-8 h-8" />
          )}
        </div>
        
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {isProcessing ? 'Processando áudio...' : 'Carregar arquivo de música'}
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
            {isProcessing 
              ? 'Isso pode levar alguns segundos dependendo do tamanho.' 
              : 'Arraste e solte ou clique para selecionar (MP3, WAV, AAC)'
            }
          </p>
        </div>
      </div>

      {/* Background decoration */}
      <Music className="absolute -bottom-8 -right-8 w-40 h-40 text-slate-100 -rotate-12 pointer-events-none" />
    </div>
  );
};

export default Dropzone;
