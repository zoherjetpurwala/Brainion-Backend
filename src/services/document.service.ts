import { generateEmbedding } from "./embedding.service.js";
import PDFParser from "pdf2json";
import * as mammoth from "mammoth";

// Type definitions
interface ProcessedDocument {
  content: string;
  embedding: number[];
  metadata: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    processedAt: string;
    pageCount?: number;
    wordCount?: number;
    characterCount?: number;
    extractionMethod?: string;
  };
}

interface DocumentProcessor {
  canProcess: (mimeType: string) => boolean;
  process: (file: Express.Multer.File) => Promise<string>;
  name: string;
}

// Constants
const MAX_CONTENT_LENGTH = 50000; // Increased limit
const MIN_CONTENT_LENGTH = 10; // Minimum viable content
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Supported file types
const SUPPORTED_MIME_TYPES = {
  PDF: [
    "application/pdf",
    "application/x-pdf",
    "application/acrobat",
    "application/vnd.pdf",
  ],
  DOCX: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  DOC: ["application/msword"],
  TEXT: ["text/plain", "text/markdown", "text/csv", "application/rtf"],
};

// Text cleaning and processing utilities
const cleanText = (text: string): string => {
  return (
    text
      // Remove excessive whitespace
      .replace(/\s+/g, " ")
      // Remove special characters but keep basic punctuation
      .replace(/[^\w\s\.\,\!\?\;\:\-\(\)]/g, " ")
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, "")
      // Remove email addresses
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "")
      // Trim and normalize
      .trim()
  );
};

const extractMetrics = (text: string) => {
  const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
  const characterCount = text.length;
  return { wordCount, characterCount };
};

// PDF Processor
const pdfProcessor: DocumentProcessor = {
  name: "PDF Parser",
  canProcess: (mimeType: string) => SUPPORTED_MIME_TYPES.PDF.includes(mimeType),

  process: async (file: Express.Multer.File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, true); // Enable verbose mode for better error reporting

      // Set timeout for PDF processing
      const timeout = setTimeout(() => {
        reject(new Error("PDF processing timeout (30 seconds)"));
      }, 30000);

      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        clearTimeout(timeout);
        try {
          if (!pdfData.Pages || pdfData.Pages.length === 0) {
            reject(new Error("PDF appears to be empty or corrupted"));
            return;
          }

          const text = pdfData.Pages.map((page: any) => {
            if (!page.Texts) return "";
            return page.Texts.map((textItem: any) => {
              if (!textItem.R) return "";
              return textItem.R.map((r: any) =>
                decodeURIComponent(r.T || "")
              ).join(" ");
            }).join(" ");
          })
            .join("\n")
            .trim();

          if (text.length < MIN_CONTENT_LENGTH) {
            reject(new Error("PDF contains insufficient extractable text"));
            return;
          }

          resolve(text);
        } catch (err) {
          reject(
            new Error(
              `PDF text extraction failed: ${
                err instanceof Error ? err.message : "Unknown error"
              }`
            )
          );
        }
      });

      pdfParser.on("pdfParser_dataError", (error: any) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `PDF parsing error: ${
              error.parserError || error.message || "Unknown PDF error"
            }`
          )
        );
      });

      try {
        pdfParser.parseBuffer(file.buffer);
      } catch (err) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Failed to start PDF parsing: ${
              err instanceof Error ? err.message : "Unknown error"
            }`
          )
        );
      }
    });
  },
};

// DOCX Processor
const docxProcessor: DocumentProcessor = {
  name: "DOCX Parser",
  canProcess: (mimeType: string) =>
    SUPPORTED_MIME_TYPES.DOCX.includes(mimeType),

  process: async (file: Express.Multer.File): Promise<string> => {
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });

      if (result.messages.length > 0) {
        console.warn("DOCX parsing warnings:", result.messages);
      }

      const text = result.value.trim();

      if (text.length < MIN_CONTENT_LENGTH) {
        throw new Error("DOCX contains insufficient extractable text");
      }

      return text;
    } catch (error) {
      throw new Error(
        `DOCX processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  },
};

// Text File Processor
const textProcessor: DocumentProcessor = {
  name: "Text Parser",
  canProcess: (mimeType: string) =>
    SUPPORTED_MIME_TYPES.TEXT.includes(mimeType),

  process: async (file: Express.Multer.File): Promise<string> => {
    try {
      // Try UTF-8 first
      let text = file.buffer.toString("utf8");

      // Check for invalid UTF-8 characters and try other encodings
      if (text.includes("\uFFFD")) {
        // Try latin1 encoding as fallback
        text = file.buffer.toString("latin1");
      }

      text = text.trim();

      if (text.length < MIN_CONTENT_LENGTH) {
        throw new Error("Text file contains insufficient content");
      }

      return text;
    } catch (error) {
      throw new Error(
        `Text processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  },
};

// Main document processors array
const processors: DocumentProcessor[] = [
  pdfProcessor,
  docxProcessor,
  textProcessor,
];

// Enhanced validation function
export const validateDocument = (
  file: Express.Multer.File
): { isValid: boolean; error?: string } => {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: `File size (${(file.size / 1024 / 1024).toFixed(
        2
      )}MB) exceeds maximum allowed size (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    };
  }

  // Check if file has content
  if (file.size === 0) {
    return {
      isValid: false,
      error: "File is empty",
    };
  }

  // Check MIME type
  const allSupportedTypes = Object.values(SUPPORTED_MIME_TYPES).flat();
  if (!allSupportedTypes.includes(file.mimetype)) {
    return {
      isValid: false,
      error: `Unsupported file type: ${file.mimetype}. Supported types: PDF, DOCX, DOC, TXT, MD, CSV, RTF`,
    };
  }

  // Check file extension matches MIME type
  const extension = file.originalname.split(".").pop()?.toLowerCase();
  const expectedExtensions: Record<string, string[]> = {
    "application/pdf": ["pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      "docx",
    ],
    "application/msword": ["doc"],
    "text/plain": ["txt"],
    "text/markdown": ["md", "markdown"],
    "text/csv": ["csv"],
    "application/rtf": ["rtf"],
  };

  const validExtensions = expectedExtensions[file.mimetype];
  if (validExtensions && extension && !validExtensions.includes(extension)) {
    return {
      isValid: false,
      error: `File extension .${extension} doesn't match MIME type ${file.mimetype}`,
    };
  }

  return { isValid: true };
};

// Main processing function
export const processDocument = async (
  file: Express.Multer.File
): Promise<ProcessedDocument> => {
  try {
    // Validate the document first
    const validation = validateDocument(file);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Find appropriate processor
    const processor = processors.find((p) => p.canProcess(file.mimetype));
    if (!processor) {
      throw new Error(`No processor available for MIME type: ${file.mimetype}`);
    }

    console.log(`Processing ${file.originalname} using ${processor.name}`);

    // Extract text content
    let rawText: string;
    try {
      rawText = await processor.process(file);
    } catch (processingError) {
      throw new Error(
        `Document processing failed: ${
          processingError instanceof Error
            ? processingError.message
            : "Unknown processing error"
        }`
      );
    }

    // Clean and process the text
    const cleanedText = cleanText(rawText);

    if (cleanedText.length < MIN_CONTENT_LENGTH) {
      throw new Error(
        `Extracted text is too short (${cleanedText.length} characters). Minimum required: ${MIN_CONTENT_LENGTH}`
      );
    }

    // Truncate if necessary
    const finalContent =
      cleanedText.length > MAX_CONTENT_LENGTH
        ? cleanedText.slice(0, MAX_CONTENT_LENGTH) + "..."
        : cleanedText;

    // Generate embedding
    let embedding: number[];
    try {
      embedding = await generateEmbedding(finalContent);
    } catch (embeddingError) {
      throw new Error(
        `Embedding generation failed: ${
          embeddingError instanceof Error
            ? embeddingError.message
            : "Unknown embedding error"
        }`
      );
    }

    // Calculate metrics
    const metrics = extractMetrics(finalContent);

    // Prepare metadata
    const metadata = {
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      processedAt: new Date().toISOString(),
      extractionMethod: processor.name,
      wordCount: metrics.wordCount,
      characterCount: metrics.characterCount,
      ...(rawText !== finalContent && { truncated: true }),
    };

    console.log(
      `Successfully processed ${file.originalname}: ${metrics.wordCount} words, ${metrics.characterCount} characters`
    );

    return {
      content: finalContent,
      embedding,
      metadata,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(
      `Error processing document ${file.originalname}:`,
      errorMessage
    );
    throw new Error(`Failed to process document: ${errorMessage}`);
  }
};

// Legacy function for backward compatibility
export const validatePDF = (file: Express.Multer.File): boolean => {
  return SUPPORTED_MIME_TYPES.PDF.includes(file.mimetype);
};

// Utility function to get supported file types
export const getSupportedFileTypes = (): string[] => {
  return Object.values(SUPPORTED_MIME_TYPES).flat();
};

// Utility function to get file type category
export const getFileTypeCategory = (mimeType: string): string | null => {
  for (const [category, types] of Object.entries(SUPPORTED_MIME_TYPES)) {
    if (types.includes(mimeType)) {
      return category;
    }
  }
  return null;
};
