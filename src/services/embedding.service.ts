import { GoogleGenerativeAI } from "@google/generative-ai";

// Constants
const MAX_BYTES = 8000; // Reduced from 9000 for safety margin
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second
const MIN_TEXT_LENGTH = 5;
const EMBEDDING_DIMENSION = 768; // text-embedding-004 dimension

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Types
interface EmbeddingConfig {
  maxBytes?: number;
  maxRetries?: number;
  retryDelay?: number;
  preprocessText?: boolean;
}

interface EmbeddingResult {
  embedding: number[];
  originalLength: number;
  processedLength: number;
  truncated: boolean;
  processingTime: number;
}

// Text preprocessing utilities
const preprocessText = (text: string): string => {
  return text
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove excessive punctuation
    .replace(/[.]{3,}/g, '...')
    .replace(/[!]{2,}/g, '!')
    .replace(/[?]{2,}/g, '?')
    // Remove non-printable characters
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    // Remove excessive line breaks
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
};

const validateText = (text: string): { isValid: boolean; error?: string } => {
  if (!text || typeof text !== 'string') {
    return { isValid: false, error: 'Text must be a non-empty string' };
  }

  if (text.trim().length < MIN_TEXT_LENGTH) {
    return { isValid: false, error: `Text too short. Minimum length: ${MIN_TEXT_LENGTH} characters` };
  }

  return { isValid: true };
};

const truncateText = (text: string, maxBytes: number): { text: string; truncated: boolean } => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);

  if (encoded.length <= maxBytes) {
    return { text, truncated: false };
  }

  // Truncate at byte boundary and decode
  const truncatedBytes = encoded.slice(0, maxBytes);
  let truncatedText = new TextDecoder("utf-8", { fatal: false }).decode(truncatedBytes);
  
  // Remove any incomplete characters at the end
  truncatedText = truncatedText.replace(/[^\x00-\x7F]*$/, '');
  
  // Try to truncate at word boundary if possible
  const lastSpaceIndex = truncatedText.lastIndexOf(' ');
  if (lastSpaceIndex > maxBytes * 0.8) { // Only if we don't lose too much content
    truncatedText = truncatedText.substring(0, lastSpaceIndex);
  }

  return { text: truncatedText, truncated: true };
};

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Exponential backoff retry logic
const withRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelay: number = RETRY_DELAY_BASE
): Promise<T> => {
  let lastError: Error = Error('Unknown error');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on certain types of errors
      if (lastError.message.includes('API key') || 
          lastError.message.includes('authentication') ||
          lastError.message.includes('quota') ||
          lastError.message.includes('billing')) {
        throw lastError;
      }

      if (attempt === maxRetries) {
        break; // Last attempt, don't wait
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(`Embedding generation attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, lastError.message);
      await sleep(delay);
    }
  }

  throw new Error(`Embedding generation failed after ${maxRetries + 1} attempts. Last error: ${lastError.message}`);
};

// Main embedding generation function
export const generateEmbedding = async (
  text: string, 
  config: EmbeddingConfig = {}
): Promise<number[]> => {
  const startTime = Date.now();
  
  try {
    // Validate API key
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    // Apply configuration
    const {
      maxBytes = MAX_BYTES,
      maxRetries = MAX_RETRIES,
      retryDelay = RETRY_DELAY_BASE,
      preprocessText: shouldPreprocess = true
    } = config;

    // Validate input text
    const validation = validateText(text);
    if (!validation.isValid) {
      throw new Error(`Text validation failed: ${validation.error}`);
    }

    // Preprocess text if enabled
    let processedText = shouldPreprocess ? preprocessText(text) : text;
    
    // Truncate text if necessary
    const { text: truncatedText, truncated } = truncateText(processedText, maxBytes);

    if (truncated) {
      console.warn(`Text was truncated from ${text.length} to ${truncatedText.length} characters`);
    }

    // Generate embedding with retry logic
    const result = await withRetry(async () => {
      const response = await model.embedContent(truncatedText);
      
      if (!response.embedding || !response.embedding.values) {
        throw new Error('Invalid response from embedding API: missing embedding values');
      }

      return response.embedding.values;
    }, maxRetries, retryDelay);

    // Validate embedding result
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error('Invalid embedding: empty or non-array result');
    }

    if (result.length !== EMBEDDING_DIMENSION) {
      console.warn(`Unexpected embedding dimension: ${result.length}, expected: ${EMBEDDING_DIMENSION}`);
    }

    // Validate that all values are numbers
    if (!result.every(val => typeof val === 'number' && !isNaN(val))) {
      throw new Error('Invalid embedding: contains non-numeric values');
    }

    const processingTime = Date.now() - startTime;
    console.log(`Embedding generated successfully in ${processingTime}ms (${truncated ? 'truncated' : 'full'} text)`);

    return result;

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`Error generating embedding after ${processingTime}ms:`, error);
    
    if (error instanceof Error) {
      throw new Error(`Embedding generation failed: ${error.message}`);
    } else {
      throw new Error('Embedding generation failed: Unknown error');
    }
  }
};

// Enhanced embedding generation with detailed result
export const generateEmbeddingDetailed = async (
  text: string,
  config: EmbeddingConfig = {}
): Promise<EmbeddingResult> => {
  const startTime = Date.now();
  const originalLength = text.length;

  try {
    const embedding = await generateEmbedding(text, config);
    const { text: processedText, truncated } = truncateText(
      config.preprocessText !== false ? preprocessText(text) : text,
      config.maxBytes || MAX_BYTES
    );
    
    return {
      embedding,
      originalLength,
      processedLength: processedText.length,
      truncated,
      processingTime: Date.now() - startTime
    };
  } catch (error) {
    throw error; // Re-throw the error from generateEmbedding
  }
};

// Batch embedding generation
export const generateEmbeddingsBatch = async (
  texts: string[],
  config: EmbeddingConfig = {}
): Promise<number[][]> => {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('Texts must be a non-empty array');
  }

  const maxConcurrent = 5; // Limit concurrent requests
  const results: number[][] = [];
  
  for (let i = 0; i < texts.length; i += maxConcurrent) {
    const batch = texts.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(text => generateEmbedding(text, config));
    
    try {
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    } catch (error) {
      console.error(`Batch embedding generation failed for batch starting at index ${i}:`, error);
      throw error;
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + maxConcurrent < texts.length) {
      await sleep(100);
    }
  }

  return results;
};

// Utility function to calculate embedding similarity
export const calculateCosineSimilarity = (embedding1: number[], embedding2: number[]): number => {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have the same dimension');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }

  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
};

// Health check function
export const checkEmbeddingService = async (): Promise<{ status: string; responseTime?: number; error?: string }> => {
  try {
    const startTime = Date.now();
    await generateEmbedding("Health check test");
    const responseTime = Date.now() - startTime;
    
    return {
      status: "healthy",
      responseTime
    };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

// Export configuration constants for external use
export const EMBEDDING_CONFIG = {
  MAX_BYTES,
  MAX_RETRIES,
  RETRY_DELAY_BASE,
  MIN_TEXT_LENGTH,
  EMBEDDING_DIMENSION
};