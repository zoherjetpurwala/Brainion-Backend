import { generateEmbedding } from "./embedding.service.js";
import PDFParser from "pdf2json";

export const processDocument = async (file: Express.Multer.File) => {
  try {
    const pdfParser = new PDFParser();

    // Convert buffer to text using a Promise wrapper
    const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
      return new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataReady", (pdfData) => {
          try {
            // Decode the text content
            const text = decodeURIComponent(pdfData.Pages.flatMap(page => 
              page.Texts.map(text => text.R.map(r => r.T).join(' '))
            ).join(' '));
            resolve(text);
          } catch (err) {
            reject(err);
          }
        });

        pdfParser.on("pdfParser_dataError", reject);

        try {
          pdfParser.parseBuffer(file.buffer);
        } catch (err) {
          reject(err);
        }
      });
    };

    // Extract text content
    const text = await extractTextFromPDF(file.buffer);
    console.log(text);
    

    // Generate embedding for the text content
    const embedding = await generateEmbedding(text);

    // Trim content if it's too long for your database
    const maxContentLength = 10000; // Adjust based on your database limits
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
        processedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error processing document:", errorMessage);
    throw new Error(`Failed to process document: ${errorMessage}`);
  }
};

// Helper function to validate PDF file
export const validatePDF = (file: Express.Multer.File): boolean => {
  const validPDFTypes = [
    'application/pdf',
    'application/x-pdf',
    'application/acrobat',
    'application/vnd.pdf',
  ];

  return validPDFTypes.includes(file.mimetype);
};