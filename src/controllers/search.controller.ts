import { Request, Response } from "express";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

export const searchFunction = async (req: Request, res: Response) => {
    try {
      const { query, userId, similarityThreshold = 0.5 } = req.body;
  
      if (!query) return res.status(400).json({ error: "Question is required" });
      if (!userId) return res.status(400).json({ error: "User ID is required" });
  
      const queryEmbedding = await generateEmbedding(query);
  
      const results: any = await prisma.$queryRaw`
      SELECT title, content, "createdAt", 1 - (embedding <=> ${queryEmbedding}::vector) AS cosine_similarity
      FROM "Content"
      WHERE "userId" = ${userId}
      AND 1 - (embedding <=> ${queryEmbedding}::vector) > ${similarityThreshold}
      ORDER BY cosine_similarity DESC
      LIMIT 3;
    `;
  
      if (results.length === 0) {
        return res.status(404).json({ error: "No relevant content found" });
      }
  
      const relevantContent = results[0].content;
      const getTitle = results[0].title;
  
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `
        Context: ${relevantContent}
        Question: ${query}
        Answer in a clear and concise manner just based on the context given.
      `;
      const result = await model.generateContent(prompt);
  
      const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
  
      res.status(200).json({
        title: getTitle,
        answer: text,
        listOfNotes: results,
      });
    } catch (error) {
      console.error("Error answering question:", error);
      res.status(500).json({ error: "Failed to process the question" });
    }
  };

