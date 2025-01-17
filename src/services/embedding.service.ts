import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "text-embedding-004"});

export const generateEmbedding = async (text: string): Promise<number[]> => {
  try {
    const result = await model.embedContent(text);

    return result.embedding.values;
  } catch (error:any) {
    console.error("Error generating embedding with Gemini API:", error.message);
    throw new Error("Failed to generate embedding");
  }
};
