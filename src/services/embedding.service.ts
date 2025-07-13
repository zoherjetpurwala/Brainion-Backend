import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

const truncateText = (text: string, maxBytes: number): string => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);

  if (encoded.length <= maxBytes) {
    return text;
  }

  let truncated = encoded.slice(0, maxBytes);
  
  while (truncated.length > 0 && (truncated[truncated.length - 1] & 0xC0) === 0x80) {
    truncated = truncated.slice(0, -1);
  }

  if (truncated.length > 0) {
    const lastByte = truncated[truncated.length - 1];
    // Check if this is the start of a 2, 3, or 4-byte sequence
    if ((lastByte & 0xE0) === 0xC0 || // 2-byte sequence start
        (lastByte & 0xF0) === 0xE0 || // 3-byte sequence start  
        (lastByte & 0xF8) === 0xF0) { // 4-byte sequence start
      truncated = truncated.slice(0, -1);
    }
  }

  return new TextDecoder("utf-8").decode(truncated);
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  try {
    if (!text || typeof text !== 'string') {
      throw new Error("Invalid input: text must be a non-empty string");
    }

    if (text.trim().length === 0) {
      throw new Error("Invalid input: text cannot be empty or only whitespace");
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const truncatedText = truncateText(text, 9_000);
    
    if (truncatedText.length < text.length) {
      console.warn(`Text truncated from ${text.length} to ${truncatedText.length} characters`);
    }

    const result = await model.embedContent(truncatedText);
    
    if (!result?.embedding?.values || !Array.isArray(result.embedding.values)) {
      throw new Error("Invalid response from Gemini API: missing embedding values");
    }

    if (result.embedding.values.length === 0) {
      throw new Error("Invalid response from Gemini API: empty embedding values");
    }

    return result.embedding.values;
  } catch (error: any) {
    if (error.message?.includes('API key')) {
      console.error("Gemini API authentication error:", error.message);
      throw new Error("Authentication failed: Invalid or missing API key");
    }
    
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      console.error("Gemini API rate limit error:", error.message);
      throw new Error("API rate limit exceeded. Please try again later.");
    }

    if (error.message?.includes('Invalid input')) {
      console.error("Input validation error:", error.message);
      throw error;
    }

    console.error("Error generating embedding with Gemini API:", error.message);
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
};

export const generateEmbeddingSimple = async (text: string): Promise<number[]> => {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error("Invalid input: text must be a non-empty string");
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const maxChars = 2250;
    const truncatedText = text.length > maxChars 
      ? text.slice(0, maxChars) 
      : text;

    const result = await model.embedContent(truncatedText);
    
    if (!result?.embedding?.values || !Array.isArray(result.embedding.values)) {
      throw new Error("Invalid response from Gemini API");
    }

    return result.embedding.values;
  } catch (error: any) {
    console.error("Error generating embedding:", error.message);
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
};