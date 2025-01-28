import { generateEmbedding } from "./embedding.service.js";
import PDFParser from "pdf2json";

export const processDocument = async (file: Express.Multer.File) => {
  try {
    const pdfParser = new PDFParser();

    const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
      return new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataReady", (pdfData) => {
          try {
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

    const text = await extractTextFromPDF(file.buffer);    

    const embedding = await generateEmbedding(text);

    const maxContentLength = 20000; // Adjust based on your database limits
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

export const validatePDF = (file: Express.Multer.File): boolean => {
  const validPDFTypes = [
    'application/pdf',
    'application/x-pdf',
    'application/acrobat',
    'application/vnd.pdf',
  ];

  return validPDFTypes.includes(file.mimetype);
};