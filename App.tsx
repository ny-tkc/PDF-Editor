import React, { useState, useRef, useEffect, useCallback } from 'react';
import { loadPDF, generateFinalPDF, renderHighResPage } from './utils/pdfUtils';
import { PDFPageData, SourcePDF, Annotation } from './types';
import AnnotationEditor from './components/AnnotationEditor';
import { Upload, FileDown, Trash2, RotateCw, Edit3, Image as ImageIcon, Copy, Plus } from 'lucide-react';

declare const download: any;

function App() {
  const [pages, setPages] = useState<PDFPageData[]>([]);
  const [sources, setSources] = useState<Map<string, SourcePDF>>(new Map());
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [editorPage, setEditorPage] = useState<{page: PDFPageData, highResUrl: string} | null>(null);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: File[], isPaste = false) => {
    if (files.length === 0) return;
    setIsProcessing(true);
    try {
        const newSources = new Map(sources);
        const newPages = [...pages];
        let lastAddedPage: PDFPageData | null = null;
        let lastAddedSource: SourcePDF | null = null;

        for (const file of files) {
             try {
                const { source, pages: extractedPages } = await loadPDF(file);
                newSources.set(source.id, source);
                extractedPages.forEach(p => newPages.push(p));
                
                if (extractedPages.length > 0) {
                    lastAddedPage = extractedPages[0];
                    lastAddedSource = source;
                }
             } catch (e) {
                 console.error(`Failed to load ${file.name}`, e);
             }
        }

        setSources(newSources);
        setPages(newPages);
        
        if (isPaste && lastAddedPage && lastAddedSource) {
             const url = await renderHighResPage(lastAddedPage, lastAddedSource);
             setEditorPage({ page: lastAddedPage, highResUrl: url });
        }

    } catch (error) {
        console.error("Error processing files", error);
        alert("ファイルの処理中にエラーが発生しました。");
    } finally {
        setIsProcessing(false);
    }
  }, [pages, sources]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        processFiles(Array.from(e.target.files));
        e.target.value = '';
    }
  };

  useEffect(() => {
      const handlePaste = (e: ClipboardEvent) => {
          if (e.clipboardData && e.clipboardData.files.length > 0) {
               e.preventDefault();
               processFiles(Array.from(e.clipboardData.files), true);
          }
      };
      window.addEventListener('paste', handlePaste);
      return () => window.removeEventListener('paste', handlePaste);
  }, [processFiles]);

  const handleDragOverFile = (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('Files')) {
         setIsDraggingFile(true);
      }
  };

  const handleDragLeaveFile = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
  };

  const handleDropFile = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processFiles(Array.from(e.dataTransfer.files));
      }
  };

  const handlePageDragStart = (e: React.DragEvent, index: number) => {
      e.stopPropagation(); 
      e.dataTransfer.effectAllowed = "move";
      setDraggedPageIndex(index);
  };

  const handlePageDragOver = (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation(); 
      e.dataTransfer.dropEffect = "move";
  };

  const handlePageDrop = (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      e.stopPropagation(); 
      
      if (draggedPageIndex === null || draggedPageIndex === dropIndex) return;

      const newPages = [...pages];
      const [draggedPage] = newPages.splice(draggedPageIndex, 1);
      newPages.splice(dropIndex, 0, draggedPage);
      
      setPages(newPages);
      setDraggedPageIndex(null);
  };

  const toggleSelectPage = (id: string) => {
    const newSet = new Set(selectedPageIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedPageIds(newSet);
  };

  const deleteSelected = () => {
    // Only verify that we have pages to delete
    if (selectedPageIds.size === 0) return;

    if (confirm(`選択した${selectedPageIds.size}ページを削除しますか？`)) {
      setPages(prevPages => {
          const newPages = prevPages.filter(p => !selectedPageIds.has(p.id));
          return newPages;
      });
      setSelectedPageIds(new Set());
    }
  };

  const rotateSelected = () => {
    setPages(pages.map(p => {
      if (selectedPageIds.has(p.id)) {
        return { ...p, rotation: (p.rotation + 90) % 360 };
      }
      return p;
    }));
  };

  const openEditor = async (page: PDFPageData) => {
    setIsProcessing(true);
    const source = sources.get(page.sourcePdfId);
    if (source) {
        const url = await renderHighResPage(page, source);
        setEditorPage({ page, highResUrl: url });
    }
    setIsProcessing(false);
  };

  const saveAnnotations = (newAnnotations: Annotation[]) => {
    if (editorPage) {
        setPages(pages.map(p => p.id === editorPage.page.id ? { ...p, annotations: newAnnotations } : p));
        setEditorPage(null);
    }
  };

  const exportPDF = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
        const pdfBytes = await generateFinalPDF(pages, sources);
        download(pdfBytes, "edited_document.pdf", "application/pdf");
    } catch (e) {
        console.error(e);
        alert("保存中にエラーが発生しました。");
    } finally {
        setIsProcessing(false);
    }
  };

  const copyToClipboard = async () => {
      if (selectedPageIds.size !== 1) {
          alert("クリップボードにコピーするには、ページを1つだけ選択してください。");
          return;
      }
      const pageId = Array.from(selectedPageIds)[0];
      const page = pages.find(p => p.id === pageId);
      const source = sources.get(page?.sourcePdfId || "");
      
      if (page && source) {
          setIsProcessing(true);
          try {
            const baseImgUrl = await renderHighResPage(page, source);
            const canvas = document.createElement('canvas');
            const img = new Image();
            img.onload = async () => {
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if(!ctx) return;
                
                ctx.drawImage(img, 0, 0);
                
                const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve) => {
                   const i = new Image();
                   i.onload = () => resolve(i);
                   i.src = src;
                });

                for (const ann of page.annotations) {
                    const scale = img.width / page.originalWidth;
                    const x = ann.x * scale;
                    const y = ann.y * scale;
                    const w = (ann.width || 0) * scale;
                    const h = (ann.height || 0) * scale;

                    ctx.globalAlpha = 1.0;

                    if (ann.type === 'highlight') {
                        ctx.fillStyle = ann.color;
                        ctx.globalAlpha = 0.4;
                        ctx.fillRect(x, y, w, h);
                        ctx.globalAlpha = 1.0;
                    } else if (ann.type === 'rect') {
                        ctx.strokeStyle = ann.color;
                        ctx.fillStyle = ann.color;
                        ctx.lineWidth = 4 * scale;
                        ctx.strokeRect(x, y, w, h);
                    } else if (ann.type === 'text' && ann.text) {
                        ctx.fillStyle = ann.color;
                        ctx.font = `${ann.fontWeight || 'normal'} ${Math.max(12, (ann.fontSize || 32) * scale)}px sans-serif`;
                        ctx.textBaseline = 'top';
                        ctx.fillText(ann.text, x, y);
                    } else if (ann.type === 'arrow') {
                         ctx.strokeStyle = ann.color;
                         ctx.fillStyle = ann.color;
                         ctx.lineWidth = 5 * scale;
                         const headlen = 20 * scale; 
                         const angle = Math.atan2(h, w);
                         const toX = x + w;
                         const toY = y + h;
                         
                         ctx.beginPath();
                         ctx.moveTo(x, y);
                         ctx.lineTo(toX, toY);
                         ctx.stroke();
                         
                         ctx.beginPath();
                         ctx.moveTo(toX, toY);
                         ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
                         ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
                         ctx.closePath();
                         ctx.fill();
                    } else if (ann.type === 'image' && ann.imageData) {
                        const annImg = await loadImage(ann.imageData);
                        ctx.drawImage(annImg, x, y, w, h);
                    }
                }

                canvas.toBlob(blob => {
                    if (blob) {
                        navigator.clipboard.write([
                            new ClipboardItem({ [blob.type]: blob })
                        ]).then(() => alert("画像をクリップボードにコピーしました！"))
                          .catch(() => alert("コピーに失敗しました"));
                    }
                });
                setIsProcessing(false);
            };
            img.src = baseImgUrl;

          } catch (e) {
              console.error(e);
              setIsProcessing(false);
              alert("画像の生成に失敗しました");
          }
      } else {
        setIsProcessing(false);
      }
  };

  return (
    <div 
        className="min-h-screen bg-slate-100 flex flex-col"
        onDragOver={handleDragOverFile}
        onDragLeave={handleDragLeaveFile}
        onDrop={handleDropFile}
    >
      {/* File Dragging Overlay */}
      {isDraggingFile && (
          <div className="fixed inset-0 bg-brand-500/10 border-4 border-brand-500 z-50 flex items-center justify-center pointer-events-none">
              <div className="bg-white p-6 rounded-xl shadow-2xl flex flex-col items-center">
                  <Upload size={48} className="text-brand-600 mb-2" />
                  <p className="text-xl font-bold text-brand-700">ここにファイルをドロップ</p>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="bg-brand-600 text-white p-2 rounded-lg">
                    <Edit3 size={24} />
                </div>
                <h1 className="text-xl font-bold text-slate-800 hidden sm:block">PDF Master Studio</h1>
            </div>

            <div className="flex items-center gap-2">
                 <input 
                    type="file" 
                    multiple 
                    accept="application/pdf,image/*" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload}
                />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition"
                    title="PDFや画像を追加"
                >
                    <Plus size={18} /> <span className="hidden sm:inline">追加</span>
                </button>

                <div className="h-6 w-px bg-slate-300 mx-2"></div>

                <button 
                    onClick={rotateSelected}
                    disabled={selectedPageIds.size === 0}
                    className="p-2 text-slate-600 hover:text-brand-600 disabled:opacity-30 disabled:hover:text-slate-600 transition"
                    title="回転"
                >
                    <RotateCw size={20} />
                </button>
                <button 
                    onClick={deleteSelected}
                    disabled={selectedPageIds.size === 0}
                    className="p-2 text-slate-600 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-600 transition"
                    title="削除"
                >
                    <Trash2 size={20} />
                </button>
                <button 
                    onClick={copyToClipboard}
                    disabled={selectedPageIds.size !== 1}
                    className="p-2 text-slate-600 hover:text-brand-600 disabled:opacity-30 disabled:hover:text-slate-600 transition"
                    title="画像をコピー"
                >
                    <Copy size={20} />
                </button>

                <div className="h-6 w-px bg-slate-300 mx-2"></div>

                <button 
                    onClick={exportPDF}
                    disabled={pages.length === 0}
                    className="flex items-center gap-2 px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-md font-bold shadow-sm transition disabled:opacity-50"
                >
                    <FileDown size={18} /> 保存 (PDF)
                </button>
            </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {pages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 mt-20">
                <Upload size={64} className="mb-4 opacity-50" />
                <p className="text-xl font-medium mb-2">PDFや画像をドロップ</p>
                <p className="text-sm">またはクリップボードから画像を貼り付け (Ctrl+V)</p>
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-6 px-6 py-3 bg-white border border-slate-300 rounded-lg shadow-sm hover:shadow-md transition text-slate-700"
                >
                    ファイルを選択
                </button>
            </div>
        ) : (
            <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {pages.map((page, index) => (
                    <div 
                        key={page.id}
                        draggable
                        onDragStart={(e) => handlePageDragStart(e, index)}
                        onDragOver={(e) => handlePageDragOver(e, index)}
                        onDrop={(e) => handlePageDrop(e, index)}
                        className={`
                            relative group rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer shadow-sm
                            ${selectedPageIds.has(page.id) ? 'border-brand-500 ring-2 ring-brand-200 shadow-md' : 'border-slate-200 hover:border-brand-300'}
                            ${draggedPageIndex === index ? 'opacity-40 border-dashed border-brand-500' : 'opacity-100'}
                        `}
                        onClick={() => toggleSelectPage(page.id)}
                    >
                        {/* Status Bar */}
                        <div className="absolute top-0 left-0 right-0 bg-black/40 text-white text-xs py-1 px-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                            <span>Page {page.pageIndex + 1}</span>
                            {page.annotations.length > 0 && <span className="bg-brand-500 px-1 rounded">編集済</span>}
                        </div>

                        {/* Image Preview Container */}
                        <div className="bg-slate-300 aspect-[3/4] relative overflow-hidden flex items-center justify-center pointer-events-none">
                            <div style={{ width: '100%', height: '100%', position: 'relative', transform: `rotate(${page.rotation}deg)` }}>
                                <img 
                                    src={page.thumbnailUrl} 
                                    alt={`Page ${page.pageIndex}`}
                                    className="object-contain w-full h-full"
                                    draggable={false}
                                />
                                
                                <div className="absolute inset-0 w-full h-full">
                                    {page.annotations.map((ann) => {
                                        let boxX = ann.x || 0;
                                        let boxY = ann.y || 0;
                                        let boxW = ann.width || 0;
                                        let boxH = ann.height || 0;
                                        if (boxW < 0) { boxX += boxW; boxW = Math.abs(boxW); }
                                        if (boxH < 0) { boxY += boxH; boxH = Math.abs(boxH); }

                                        const left = `${(boxX / page.originalWidth) * 100}%`;
                                        const top = `${(boxY / page.originalHeight) * 100}%`;
                                        const w = `${(boxW / page.originalWidth) * 100}%`;
                                        const h = `${(boxH / page.originalHeight) * 100}%`;
                                        
                                        if (ann.type === 'rect') {
                                            return <div key={ann.id} style={{ position: 'absolute', left, top, width: w, height: h, border: `2px solid ${ann.color}` }} />
                                        } else if (ann.type === 'highlight') {
                                            return <div key={ann.id} style={{ position: 'absolute', left, top, width: w, height: h, backgroundColor: ann.color, opacity: 0.3 }} />
                                        } else if (ann.type === 'text') {
                                            return (
                                                <div key={ann.id} style={{ 
                                                    position: 'absolute', left: `${(ann.x / page.originalWidth) * 100}%`, top: `${(ann.y / page.originalHeight) * 100}%`, 
                                                    color: ann.color, 
                                                    fontSize: '10px', 
                                                    fontWeight: ann.fontWeight || 'normal', 
                                                    whiteSpace: 'nowrap',
                                                    textShadow: '0 0 2px white'
                                                }}>
                                                    {ann.text}
                                                </div>
                                            )
                                        } else if (ann.type === 'arrow') {
                                             const startX = (ann.x / page.originalWidth) * 100;
                                             const startY = (ann.y / page.originalHeight) * 100;
                                             const dx = (ann.width || 0) / page.originalWidth * 100;
                                             const dy = (ann.height || 0) / page.originalHeight * 100;
                                             const rot = Math.atan2(dy, dx) * 180 / Math.PI;
                                             const len = Math.sqrt(dx*dx + dy*dy);
                                             
                                             return (
                                                 <div key={ann.id} style={{
                                                     position: 'absolute', left: `${startX}%`, top: `${startY}%`,
                                                     width: `${len}%`, height: '2px',
                                                     backgroundColor: ann.color,
                                                     transform: `rotate(${rot}deg)`,
                                                     transformOrigin: '0 50%'
                                                 }}>
                                                     <div style={{ position: 'absolute', right: 0, top: '-3px', width: 0, height: 0, borderLeft: '6px solid ' + ann.color, borderTop: '4px solid transparent', borderBottom: '4px solid transparent' }}></div>
                                                 </div>
                                             )
                                        } else if (ann.type === 'image' && ann.imageData) {
                                            return <img key={ann.id} src={ann.imageData} style={{ position: 'absolute', left, top, width: w, height: h, objectFit: 'contain' }} alt="ann" />
                                        }
                                        return null;
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Edit Button */}
                        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openEditor(page);
                                }}
                                className="bg-white text-slate-700 hover:text-brand-600 p-2 rounded-full shadow-lg border border-slate-100"
                                title="編集・注釈"
                            >
                                <Edit3 size={16} />
                            </button>
                        </div>

                        {/* Selection Checkbox */}
                        <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedPageIds.has(page.id) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white/80 border-slate-300 text-transparent'}`}>
                             <CheckIcon />
                        </div>
                    </div>
                ))}
            </div>
        )}
      </main>

      {/* Editor Modal */}
      {editorPage && (
          <AnnotationEditor 
            page={editorPage.page}
            imageSrc={editorPage.highResUrl}
            onClose={() => setEditorPage(null)}
            onSave={saveAnnotations}
          />
      )}

      {/* Loading Overlay */}
      {isProcessing && (
          <div className="fixed inset-0 bg-white/70 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
              <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-4"></div>
              <p className="text-slate-600 font-medium animate-pulse">処理中...</p>
          </div>
      )}
    </div>
  );
}

const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
)

export default App;