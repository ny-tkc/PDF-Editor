import { PDFDocument, Degrees, rgb } from 'pdf-lib';
import { PDFPageData, SourcePDF, Annotation } from '../types';

// Declare global variables loaded via CDN
declare const pdfjsLib: any;
declare const PDFLib: any;

export const loadPDF = async (file: File): Promise<{ source: SourcePDF, pages: PDFPageData[] }> => {
  let arrayBuffer = await file.arrayBuffer();
  let fileName = file.name;

  // Check if the file is an image and convert to PDF if so
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name);

  if (isImage && file.type !== 'application/pdf') {
    try {
      const pdfDoc = await PDFLib.PDFDocument.create();
      let image;
      
      // Try to embed based on type or fallback
      if (file.type === 'image/jpeg' || file.type === 'image/jpg' || fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')) {
        image = await pdfDoc.embedJpg(arrayBuffer);
      } else {
        // Try PNG, fallback to JPG if that fails (in case of mismatched mime/extension)
        try {
           image = await pdfDoc.embedPng(arrayBuffer);
        } catch (e) {
           image = await pdfDoc.embedJpg(arrayBuffer);
        }
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });

      const pdfBytes = await pdfDoc.save();
      arrayBuffer = pdfBytes.buffer;
      fileName = fileName + ".pdf"; // Append extension to indicate it's treated as PDF
    } catch (e) {
      console.error("Image to PDF conversion failed", e);
      throw new Error("Unsupported image format. Please use PDF, JPG, or PNG.");
    }
  }

  // Load the PDF (either original or converted from image)
  // CRITICAL: Clone buffer to prevent it from being detached by PDF.js worker
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;
  
  const sourceId = crypto.randomUUID();
  const pages: PDFPageData[] = [];

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 0.5 }); // Thumbnail scale
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    pages.push({
      id: crypto.randomUUID(),
      sourcePdfId: sourceId,
      pageIndex: i,
      rotation: 0,
      thumbnailUrl: canvas.toDataURL(),
      originalWidth: viewport.width * 2, // Restore to roughly original scale logic
      originalHeight: viewport.height * 2,
      annotations: []
    });
  }

  return {
    source: {
      id: sourceId,
      name: fileName,
      data: arrayBuffer
    },
    pages
  };
};

export const generateFinalPDF = async (pages: PDFPageData[], sources: Map<string, SourcePDF>): Promise<Uint8Array> => {
  const mergedPdf = await PDFLib.PDFDocument.create();

  for (const pageData of pages) {
    const source = sources.get(pageData.sourcePdfId);
    if (!source) continue;

    // Load source doc
    const sourcePdfDoc = await PDFLib.PDFDocument.load(source.data);
    
    // Copy page
    const [copiedPage] = await mergedPdf.copyPages(sourcePdfDoc, [pageData.pageIndex]);
    
    // Apply Rotation
    const currentRotation = copiedPage.getRotation().angle;
    copiedPage.setRotation(PDFLib.degrees(currentRotation + pageData.rotation));

    // Embed Annotations if any
    if (pageData.annotations.length > 0) {
      // Create a canvas to draw annotations
      const canvas = document.createElement('canvas');
      // Use original dimensions for high quality
      const width = pageData.originalWidth;
      const height = pageData.originalHeight;
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top'; // Align text consistently

        // Iterate sequentially to handle async image loading
        for (const ann of pageData.annotations) {
           ctx.globalAlpha = 1.0; // Reset alpha
           
           // Normalize box logic same as Editor
           let boxX = ann.x || 0;
           let boxY = ann.y || 0;
           let boxW = ann.width || 0;
           let boxH = ann.height || 0;
           
           // For text, width/height might not be set or relevant in the same way, but x,y are.
           // For shapes, we must handle negative width/height
           if (boxW < 0) { boxX += boxW; boxW = Math.abs(boxW); }
           if (boxH < 0) { boxY += boxH; boxH = Math.abs(boxH); }

           if (ann.type === 'highlight') {
               ctx.fillStyle = ann.color;
               ctx.globalAlpha = 0.4;
               ctx.fillRect(boxX, boxY, boxW, boxH);
               ctx.globalAlpha = 1.0; // Reset
           } else if (ann.type === 'rect') {
             ctx.strokeStyle = ann.color;
             ctx.fillStyle = ann.color;
             ctx.lineWidth = 4;
             ctx.strokeRect(boxX, boxY, boxW, boxH);
           } else if (ann.type === 'text' && ann.text) {
             ctx.fillStyle = ann.color;
             const fontWeight = ann.fontWeight === 'bold' ? 'bold' : 'normal';
             // Fallback default size if missing
             const fSize = ann.fontSize || 32;
             ctx.font = `${fontWeight} ${fSize}px sans-serif`;
             ctx.fillText(ann.text, ann.x, ann.y); 
           } else if (ann.type === 'arrow') {
             ctx.strokeStyle = ann.color;
             ctx.fillStyle = ann.color;
             ctx.lineWidth = 5;
             
             // Original coordinates (start)
             const fromX = ann.x;
             const fromY = ann.y;
             // End coordinates
             const toX = (ann.x + (ann.width || 0));
             const toY = (ann.y + (ann.height || 0));
             
             const headLen = 20; // Length of head in pixels
             const angle = Math.atan2(toY - fromY, toX - fromX);
             
             // Draw line
             ctx.beginPath();
             ctx.moveTo(fromX, fromY);
             ctx.lineTo(toX, toY);
             ctx.stroke();
             
             // Draw head
             ctx.beginPath();
             ctx.moveTo(toX, toY);
             ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
             ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
             ctx.closePath();
             ctx.fill();
           } else if (ann.type === 'image' && ann.imageData) {
               // Load image for canvas
               await new Promise<void>((resolve) => {
                   const img = new Image();
                   img.onload = () => {
                       ctx.drawImage(img, boxX, boxY, boxW, boxH);
                       resolve();
                   };
                   img.src = ann.imageData!;
               });
           }
        }

        const pngImageBytes = await fetch(canvas.toDataURL('image/png')).then(res => res.arrayBuffer());
        const pngImage = await mergedPdf.embedPng(pngImageBytes);
        
        copiedPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: copiedPage.getWidth(),
          height: copiedPage.getHeight(),
        });
      }
    }

    mergedPdf.addPage(copiedPage);
  }

  return await mergedPdf.save();
};

export const renderHighResPage = async (pageData: PDFPageData, source: SourcePDF): Promise<string> => {
    // CRITICAL: Clone buffer to prevent it from being detached by PDF.js worker
    const loadingTask = pdfjsLib.getDocument({ data: source.data.slice(0) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageData.pageIndex + 1);
    
    // Scale 1.5 usually good enough for editing, can go higher if needed
    const viewport = page.getViewport({ scale: 1.5, rotation: pageData.rotation });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    return canvas.toDataURL();
};