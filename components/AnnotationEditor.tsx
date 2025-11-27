import React, { useRef, useState, useEffect } from 'react';
import { Annotation, PDFPageData, ToolMode } from '../types';
import { X, Square, ArrowRight, Type, Move, Check, Highlighter, Image as ImageIcon, ZoomIn, ZoomOut, Maximize, Bold } from 'lucide-react';

interface Props {
  page: PDFPageData;
  imageSrc: string;
  onClose: () => void;
  onSave: (annotations: Annotation[]) => void;
}

const AnnotationEditor: React.FC<Props> = ({ page, imageSrc, onClose, onSave }) => {
  const [annotations, setAnnotations] = useState<Annotation[]>(page.annotations || []);
  const [tool, setTool] = useState<ToolMode>('select');
  
  // Tool settings
  const [color, setColor] = useState('#ef4444');
  const [fontSize, setFontSize] = useState(32);
  const [isBold, setIsBold] = useState(false);
  const [zoom, setZoom] = useState(0.8);
  
  // Interaction state
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 }); 
  const [currentAnnotation, setCurrentAnnotation] = useState<Partial<Annotation> | null>(null); 
  
  // Selection / Move / Resize state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'none' | 'moving' | 'resizing'>('none');
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [interactionStartPos, setInteractionStartPos] = useState({ x: 0, y: 0 });
  const [initialAnnState, setInitialAnnState] = useState<Annotation | null>(null);
  
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize zoom
  useEffect(() => {
     if (containerRef.current) {
        const viewportHeight = window.innerHeight - 140;
        const initialZoom = Math.min(0.9, viewportHeight / page.originalHeight);
        setZoom(initialZoom);
     }
  }, [page.originalHeight]);

  // Sync toolbar changes to SELECTED annotation, but NOT vice-versa (fixes the "Arrow becomes yellow" bug)
  useEffect(() => {
    if (selectedId) {
        setAnnotations(prev => prev.map(ann => {
            if (ann.id === selectedId) {
                const updates: any = {};
                // Only update color if the user is explicitly interacting with color picker (not covered here, handled in click)
                // But for FontSize/Bold, we update immediately
                if (ann.type === 'text') {
                    updates.fontSize = fontSize;
                    updates.fontWeight = isBold ? 'bold' : 'normal';
                }
                return { ...ann, ...updates };
            }
            return ann;
        }));
    }
  }, [fontSize, isBold, selectedId]);

  // Apply color change to selected item explicitly
  const applyColor = (newColor: string) => {
      setColor(newColor);
      if (selectedId) {
          setAnnotations(prev => prev.map(ann => {
              if (ann.id === selectedId) {
                  return { ...ann, color: newColor };
              }
              return ann;
          }));
      }
  };

  const getPointerPos = (e: React.MouseEvent) => {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    
    // Convert screen pixels to PDF coordinate space
    const scaleX = page.originalWidth / rect.width;
    const scaleY = page.originalHeight / rect.height;
    
    return {
      x: relX * scaleX,
      y: relY * scaleY
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // If clicking a resize handle (handled in handleResizeStart), don't trigger this
    if (interactionMode === 'resizing') return;

    // If moving is active (handled in handleAnnotationMouseDown), don't trigger drawing
    if (interactionMode === 'moving') return;

    if (tool === 'select') {
        setSelectedId(null); // Deselect if clicking empty space
        return;
    }
    
    e.preventDefault();
    const { x, y } = getPointerPos(e);
    setDragStartPos({ x, y });
    setIsDrawing(true);

    if (tool === 'text') {
       // Improved Text Input
       const text = prompt("テキストを入力してください:", "");
       if (text && text.trim() !== "") {
         const newAnn: Annotation = {
           id: crypto.randomUUID(),
           type: 'text',
           x,
           y,
           text,
           color,
           fontSize: fontSize,
           fontWeight: isBold ? 'bold' : 'normal',
         };
         setAnnotations([...annotations, newAnn]);
         setSelectedId(newAnn.id); 
       }
       setIsDrawing(false);
    } else if (tool === 'image') {
        fileInputRef.current?.click();
        setIsDrawing(false);
    } else {
      // Determine initial color based on tool, but don't overwrite global 'color' state if user didn't pick it
      const shapeColor = tool === 'highlight' ? '#ffff00' : color;
      
      setCurrentAnnotation({
        type: tool,
        x,
        y,
        width: 0,
        height: 0,
        color: shapeColor
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getPointerPos(e);

    // --- Handling Move ---
    if (interactionMode === 'moving' && selectedId && initialAnnState) {
        const dx = x - interactionStartPos.x;
        const dy = y - interactionStartPos.y;

        setAnnotations(prev => prev.map(ann => {
            if (ann.id === selectedId) {
                return { ...ann, x: initialAnnState.x + dx, y: initialAnnState.y + dy };
            }
            return ann;
        }));
        return;
    }

    // --- Handling Resize ---
    if (interactionMode === 'resizing' && selectedId && initialAnnState && resizeHandle) {
        const dx = x - interactionStartPos.x;
        const dy = y - interactionStartPos.y;

        setAnnotations(prev => prev.map(ann => {
            if (ann.id !== selectedId) return ann;

            let newX = initialAnnState.x;
            let newY = initialAnnState.y;
            let newW = initialAnnState.width || 0;
            let newH = initialAnnState.height || 0;

            // Logic allows flipping (negative width/height)
            if (resizeHandle.includes('e')) newW += dx;
            if (resizeHandle.includes('w')) { newX += dx; newW -= dx; }
            if (resizeHandle.includes('s')) newH += dy;
            if (resizeHandle.includes('n')) { newY += dy; newH -= dy; }

            return { ...ann, x: newX, y: newY, width: newW, height: newH };
        }));
        return;
    }

    // --- Handling New Drawing ---
    if (!isDrawing || !currentAnnotation || tool === 'text' || tool === 'image') return;
    
    setCurrentAnnotation(prev => ({
      ...prev,
      width: x - dragStartPos.x,
      height: y - dragStartPos.y
    }));
  };

  const handleMouseUp = () => {
    setInteractionMode('none');
    setResizeHandle(null);
    setInitialAnnState(null);

    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (currentAnnotation && (Math.abs(currentAnnotation.width || 0) > 5 || Math.abs(currentAnnotation.height || 0) > 5)) {
       const newAnn = {
         id: crypto.randomUUID(),
         type: currentAnnotation.type as any,
         x: dragStartPos.x,
         y: dragStartPos.y,
         width: currentAnnotation.width,
         height: currentAnnotation.height,
         color: currentAnnotation.color || color,
       } as Annotation;
       setAnnotations([...annotations, newAnn]);
       setSelectedId(newAnn.id);
    }
    setCurrentAnnotation(null);
  };

  const handleAnnotationMouseDown = (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); 
      if (tool !== 'select') return;

      const ann = annotations.find(a => a.id === id);
      if (!ann) return;

      setSelectedId(id);
      setInteractionMode('moving');
      setInteractionStartPos(getPointerPos(e));
      setInitialAnnState({ ...ann });
      
      // Update sidebar settings to match selected item
      // BUT do NOT change color if it's a highlight, to avoid yellow contamination for next tools
      if (ann.type === 'text') {
          setFontSize(ann.fontSize || 32);
          setIsBold(ann.fontWeight === 'bold');
      }
      if (ann.type !== 'highlight') {
          setColor(ann.color);
      }
  };

  const handleResizeStart = (e: React.MouseEvent, handle: string, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      
      const ann = annotations.find(a => a.id === id);
      if (!ann) return;

      setSelectedId(id);
      setInteractionMode('resizing');
      setResizeHandle(handle);
      setInteractionStartPos(getPointerPos(e));
      setInitialAnnState({ ...ann });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          if (event.target?.result) {
              const img = new Image();
              img.onload = () => {
                  const aspectRatio = img.height / img.width;
                  const width = 300; // Default size
                  const height = 300 * aspectRatio;
                  
                  const newAnn: Annotation = {
                      id: crypto.randomUUID(),
                      type: 'image',
                      x: 100, // Default position
                      y: 100,
                      width,
                      height,
                      color: '', 
                      imageData: event.target?.result as string
                  };
                  setAnnotations([...annotations, newAnn]);
                  setSelectedId(newAnn.id);
                  setTool('select'); // Auto switch to select mode
              };
              img.src = event.target.result as string;
          }
      };
      reader.readAsDataURL(file);
      e.target.value = ''; 
  };

  const deleteAnnotation = (id: string) => {
    setAnnotations(annotations.filter(a => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };

  const renderAnnotation = (ann: Annotation | Partial<Annotation>, isPreview = false) => {
     const isSelected = !isPreview && ann.id === selectedId;

     // Normalize box logic
     let boxX = ann.x || 0;
     let boxY = ann.y || 0;
     let boxW = ann.width || 0;
     let boxH = ann.height || 0;

     // Handle negative dimensions for CSS positioning
     if (boxW < 0) { boxX += boxW; boxW = Math.abs(boxW); }
     if (boxH < 0) { boxY += boxH; boxH = Math.abs(boxH); }

     if (ann.type === 'text') {
         // Text usually doesn't have fixed w/h
         boxW = undefined as any; 
         boxH = undefined as any;
     }

     const style: React.CSSProperties = {
       position: 'absolute',
       left: `${(boxX / page.originalWidth) * 100}%`,
       top: `${(boxY / page.originalHeight) * 100}%`,
       width: boxW !== undefined ? `${(boxW / page.originalWidth) * 100}%` : 'auto',
       height: boxH !== undefined ? `${(boxH / page.originalHeight) * 100}%` : 'auto',
       
       pointerEvents: tool === 'select' && !isPreview ? 'auto' : 'none',
       cursor: tool === 'select' ? 'move' : 'crosshair',
       userSelect: 'none',
       zIndex: isPreview ? 20 : (isSelected ? 30 : 10),
       
       // Selection Highlight
       outline: isSelected ? '2px dashed #0ea5e9' : 'none',
       outlineOffset: '2px',
     };

     const renderHandles = () => {
         if (!isSelected || ann.type === 'text') return null; // Text resizing is font-size based
         const handleStyle = "absolute w-3 h-3 bg-white border border-brand-500 rounded-full z-50 pointer-events-auto";
         return (
             <>
                <div className={`${handleStyle} -top-1.5 -left-1.5 cursor-nw-resize`} onMouseDown={(e) => handleResizeStart(e, 'nw', ann.id!)} />
                <div className={`${handleStyle} -top-1.5 -right-1.5 cursor-ne-resize`} onMouseDown={(e) => handleResizeStart(e, 'ne', ann.id!)} />
                <div className={`${handleStyle} -bottom-1.5 -left-1.5 cursor-sw-resize`} onMouseDown={(e) => handleResizeStart(e, 'sw', ann.id!)} />
                <div className={`${handleStyle} -bottom-1.5 -right-1.5 cursor-se-resize`} onMouseDown={(e) => handleResizeStart(e, 'se', ann.id!)} />
             </>
         );
     }

     const renderContent = () => {
        if (ann.type === 'arrow') {
             // Redo logic to ensure arrow draws correctly within normalized box
             // Original Vector from start(x,y) to end(x+w, y+h)
             // Normalized Box starts at min(x, x+w), min(y, y+h)
             
             const rawX = ann.x || 0;
             const rawY = ann.y || 0;
             const rawW = ann.width || 0;
             const rawH = ann.height || 0;
             
             // Relative start/end inside the Box
             const x1 = rawX - boxX;
             const y1 = rawY - boxY;
             const x2 = (rawX + rawW) - boxX;
             const y2 = (rawY + rawH) - boxY;

             // Scale head based on zoom for visibility
             const headLen = 20 * (1/zoom * 0.5 + 0.5);
             const angle = Math.atan2(y2 - y1, x2 - x1);
             const ax1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
             const ay1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
             const ax2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
             const ay2 = y2 - headLen * Math.sin(angle + Math.PI / 6);

             return (
                 <svg width="100%" height="100%" style={{ overflow: 'visible', pointerEvents: 'none' }}>
                     {/* Transparent thick line for easier clicking */}
                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="20" style={{ pointerEvents: 'stroke' }} />
                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.color} strokeWidth="5" />
                     <polygon points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`} fill={ann.color} />
                 </svg>
             );
         }
         if (ann.type === 'text') {
             return (
                 <div style={{ 
                     color: ann.color, 
                     fontSize: `${(ann.fontSize || 32) * zoom}px`, 
                     fontWeight: ann.fontWeight || 'normal',
                     whiteSpace: 'nowrap',
                     textShadow: '0px 0px 3px white', 
                     padding: '4px',
                     lineHeight: 1
                 }}>
                    {ann.text}
                 </div>
             );
         }
         if (ann.type === 'image' && ann.imageData) {
             return <img src={ann.imageData} alt="img" draggable={false} className="w-full h-full object-contain select-none" />;
         }
         if (ann.type === 'highlight') {
             // Fixed opacity, removed mix-blend-mode to prevent erasing background bugs
             return <div style={{ width: '100%', height: '100%', backgroundColor: ann.color, opacity: 0.3 }} />;
         }
         if (ann.type === 'rect') {
             return <div style={{ width: '100%', height: '100%', border: `4px solid ${ann.color}` }} />;
         }
         return null;
     }

     return (
        <div 
            key={ann.id || 'preview'} 
            style={style}
            onMouseDown={(e) => ann.id && handleAnnotationMouseDown(e, ann.id)}
        >
            {renderContent()}
            {renderHandles()}
            
            {isSelected && (
                <button 
                    onClick={(e) => { e.stopPropagation(); deleteAnnotation(ann.id!); }} 
                    className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 z-50 transform hover:scale-110 transition-transform flex items-center justify-center"
                    title="削除"
                >
                     <X size={12} />
                </button>
            )}
        </div>
     );
  };

  return (
    <div 
        className="fixed inset-0 bg-slate-900 z-50 flex flex-col"
        onDragOver={handleDragOver} 
        onDrop={handleDrop}
    >
      {/* Header */}
      <div className="bg-white p-3 flex justify-between items-center shadow-md z-20">
        <h2 className="text-lg font-bold flex items-center gap-2 text-slate-700">
            <Move className="text-brand-600" size={20}/> ページ編集
        </h2>
        
        <div className="flex items-center gap-4">
             {/* Font Controls */}
             <div className={`flex items-center gap-2 border-r border-slate-300 pr-4 transition-opacity ${tool === 'text' || (selectedId && annotations.find(a => a.id === selectedId)?.type === 'text') ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                 <Type size={16} className="text-slate-500" />
                 <input 
                    type="number" 
                    value={fontSize} 
                    onChange={(e) => setFontSize(Number(e.target.value))} 
                    className="w-16 border border-slate-300 rounded px-1 py-0.5 text-sm"
                    title="フォントサイズ"
                 />
                 <button 
                    onClick={() => setIsBold(!isBold)} 
                    className={`p-1 rounded ${isBold ? 'bg-brand-100 text-brand-600 border border-brand-200' : 'text-slate-500 hover:bg-slate-100'}`}
                    title="太字"
                 >
                     <Bold size={16} />
                 </button>
             </div>

             {/* Zoom */}
             <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                 <button onClick={() => setZoom(Math.max(0.2, zoom - 0.1))} className="p-1 hover:bg-white rounded text-slate-600"><ZoomOut size={16}/></button>
                 <span className="text-xs w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
                 <button onClick={() => setZoom(Math.min(3.0, zoom + 0.1))} className="p-1 hover:bg-white rounded text-slate-600"><ZoomIn size={16}/></button>
                 <button onClick={() => setZoom(0.8)} className="p-1 hover:bg-white rounded text-slate-600 ml-1" title="画面に合わせる"><Maximize size={16}/></button>
             </div>

             <div className="flex gap-2 ml-4">
                <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm font-medium">キャンセル</button>
                <button onClick={() => onSave(annotations)} className="px-6 py-2 bg-brand-600 text-white rounded shadow-sm hover:bg-brand-700 hover:shadow-md flex items-center gap-2 text-sm font-bold transition-all">
                    <Check size={18} /> 完了
                </button>
            </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="w-16 bg-slate-800 flex flex-col items-center py-4 gap-3 z-20 shadow-xl overflow-y-auto">
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
            
            <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={<Move size={20} />} label="移動/選択" />
            <div className="w-10 h-px bg-slate-600 my-1"></div>
            <ToolButton active={tool === 'highlight'} onClick={() => setTool('highlight')} icon={<Highlighter size={20} />} label="蛍光ペン" />
            <ToolButton active={tool === 'text'} onClick={() => setTool('text')} icon={<Type size={20} />} label="テキスト" />
            <ToolButton active={tool === 'arrow'} onClick={() => setTool('arrow')} icon={<ArrowRight size={20} />} label="矢印" />
            <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} icon={<Square size={20} />} label="赤枠" />
            <ToolButton active={tool === 'image'} onClick={() => setTool('image')} icon={<ImageIcon size={20} />} label="画像" />
            
            <div className="w-10 h-px bg-slate-600 my-1"></div>
            
            <div className="flex flex-col gap-2 mt-2">
                {['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#000000', '#ffffff'].map(c => (
                    <button
                        key={c}
                        onClick={() => applyColor(c)}
                        className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                    />
                ))}
            </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 bg-slate-500 overflow-auto relative flex items-center justify-center p-8" ref={containerRef}>
             <div 
                className="relative bg-white shadow-2xl transition-transform duration-100 ease-out origin-center"
                style={{ 
                    width: page.originalWidth * zoom, 
                    height: page.originalHeight * zoom,
                    minWidth: page.originalWidth * zoom,
                    minHeight: page.originalHeight * zoom 
                }}
             >
                  <img 
                      ref={imgRef}
                      src={imageSrc} 
                      alt="Page" 
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                      draggable={false}
                  />

                  <div 
                      className="absolute inset-0 z-10"
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
                  >
                      {annotations.map(ann => renderAnnotation(ann))}
                      {currentAnnotation && renderAnnotation(currentAnnotation, true)}
                  </div>
             </div>
        </div>

      </div>
    </div>
  );
};

const ToolButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
    <button 
        onClick={onClick}
        className={`p-3 rounded-lg transition-all flex flex-col items-center gap-1 w-full ${active ? 'bg-brand-500 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
        title={label}
    >
        {icon}
        <span className="text-[10px] whitespace-nowrap">{label}</span>
    </button>
);

export default AnnotationEditor;