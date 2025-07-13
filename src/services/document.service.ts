import { generateEmbedding } from "./embedding.service.js";
import PDFParser from "pdf2json";

export const processDocument = async (file: Express.Multer.File) => {
  try {
    const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
      return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        
        const onDataReady = (pdfData: any) => {
          try {
            const text = extractTextSafely(pdfData);
            cleanup();
            resolve(text);
          } catch (err) {
            cleanup();
            reject(err);
          }
        };

        const onDataError = (error: any) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          pdfParser.removeListener("pdfParser_dataReady", onDataReady);
          pdfParser.removeListener("pdfParser_dataError", onDataError);
        };

        pdfParser.on("pdfParser_dataReady", onDataReady);
        pdfParser.on("pdfParser_dataError", onDataError);

        try {
          pdfParser.parseBuffer(buffer);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
    };

    const text = await extractTextFromPDF(file.buffer);
    
    if (!text || text.trim().length === 0) {
      throw new Error("No text content extracted from PDF");
    }

    const embedding = await generateEmbedding(text);

    const maxContentLength = 20000;
    const trimmedContent = text.length > maxContentLength 
      ? text.slice(0, maxContentLength) + '...'
      : text;

    return {
      content: trimmedContent,
      embedding,
      metadata: {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        processedAt: new Date().toISOString(),
        originalContentLength: text.length,
        wasTrimmed: text.length > maxContentLength
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error processing document:", errorMessage);
    throw new Error(`Failed to process document: ${errorMessage}`);
  }
};

const extractTextSafely = (pdfData: any): string => {
  try {
    if (!pdfData || !pdfData.Pages || !Array.isArray(pdfData.Pages)) {
      throw new Error("Invalid PDF data structure");
    }

    const textParts: string[] = [];
    
    for (const page of pdfData.Pages) {
      if (!page.Texts || !Array.isArray(page.Texts)) {
        continue;
      }
      
      for (const textItem of page.Texts) {
        if (!textItem.R || !Array.isArray(textItem.R)) {
          continue;
        }
        
        const textContent = textItem.R
          .filter((r: any) => r && typeof r.T === 'string')
          .map((r: any) => r.T)
          .join(' ');
          
        if (textContent) {
          textParts.push(textContent);
        }
      }
    }
    
    const rawText = textParts.join(' ');
    
    try {
      return decodeURIComponent(rawText);
    } catch (decodeError) {
      console.warn("Failed to decode URI components, using raw text");
      return rawText;
    }
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const validatePDF = (file: Express.Multer.File): boolean => {
  const validPDFTypes = [
    'application/pdf',
    'application/x-pdf',
    'application/acrobat',
    'application/vnd.pdf',
  ];

  return validPDFTypes.includes(file.mimetype);
};

export const validatePDFFile = (file: Express.Multer.File): { isValid: boolean; error?: string } => {
  if (!file) {
    return { isValid: false, error: "No file provided" };
  }

  if (!validatePDF(file)) {
    return { isValid: false, error: "Invalid PDF file type" };
  }

  if (file.size === 0) {
    return { isValid: false, error: "Empty file" };
  }

  // Check for reasonable file size (e.g., max 50MB)
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    return { isValid: false, error: "File too large" };
  }

  return { isValid: true };
};