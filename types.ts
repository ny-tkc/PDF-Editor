export interface Annotation {
  id: string;
  type: 'rect' | 'arrow' | 'text' | 'highlight' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  imageData?: string; // Base64 string for image annotations
}

export interface PDFPageData {
  id: string; // Unique ID for the page in the UI
  sourcePdfId: string; // ID of the original PDF file
  pageIndex: number; // Index in the original PDF (0-based)
  rotation: number; // 0, 90, 180, 270
  thumbnailUrl: string; // Base64 image for preview
  originalWidth: number;
  originalHeight: number;
  annotations: Annotation[];
}

export interface SourcePDF {
  id: string;
  name: string;
  data: ArrayBuffer;
}

export type ToolMode = 'select' | 'rect' | 'arrow' | 'text' | 'highlight' | 'image';