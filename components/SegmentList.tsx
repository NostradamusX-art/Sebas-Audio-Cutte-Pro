import React from 'react';
import { Download, Play, Pause, FileAudio } from 'lucide-react';
import { formatTime } from '../utils/audioUtils';

export interface Segment {
  id: number;
  blob: Blob;
  startTime: number;
  endTime: number;
  fileName: string;
}

interface SegmentListProps {
  segments: Segment[];
  currentlyPlayingId: number | null;
  onPlay: (id: number) => void;
  onPause: () => void;
}

const SegmentList: React.FC<SegmentListProps> = ({ 
  segments, 
  currentlyPlayingId, 
  onPlay, 
  onPause 
}) => {
  if (segments.length === 0) return null;

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <FileAudio className="w-5 h-5 text-indigo-600" />
          Partes Geradas ({segments.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
        {segments.map((segment) => {
          const isPlaying = currentlyPlayingId === segment.id;
          
          return (
            <div 
              key={segment.id}
              className={`
                group flex items-center justify-between p-3 rounded-lg border transition-all duration-200
                ${isPlaying 
                  ? 'bg-indigo-50 border-indigo-200 shadow-sm' 
                  : 'bg-white border-slate-200 hover:border-indigo-200 hover:shadow-sm'
                }
              `}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => isPlaying ? onPause() : onPlay(segment.id)}
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center transition-colors
                    ${isPlaying 
                      ? 'bg-indigo-600 text-white' 
                      : 'bg-slate-100 text-slate-600 group-hover:bg-indigo-100 group-hover:text-indigo-600'
                    }
                  `}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>
                
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {segment.fileName}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">
                    {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                  </p>
                </div>
              </div>

              <a
                href={URL.createObjectURL(segment.blob)}
                download={segment.fileName}
                className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                title="Baixar esta parte"
              >
                <Download className="w-5 h-5" />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SegmentList;
