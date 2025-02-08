import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

const truncateText = (text: string, maxBytes: number): string => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);

  if (encoded.length <= maxBytes) {
    return text;
  }

  return new TextDecoder("utf-8").decode(encoded.slice(0, maxBytes));
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  try {
    const truncatedText = truncateText(text, 9_900);

    const result = await model.embedContent(truncatedText);
    return result.embedding.values;
  } catch (error: any) {
    console.error("Error generating embedding with Gemini API:", error.message);
    throw new Error("Failed to generate embedding");
  }
};
