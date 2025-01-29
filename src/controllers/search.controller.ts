import { Request, Response } from "express";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as chrono from "chrono-node";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

export const searchFunction = async (req: Request, res: Response) => {
  try {
    const { query, userId, similarityThreshold = 0.3 } = req.body;

    if (!query) return res.status(400).json({ error: "Question is required" });
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const queryEmbedding = await generateEmbedding(query);
    const parsedDate = chrono.parseDate(query);

    const results: any = await prisma.$queryRaw`
      SELECT title, content, "createdAt",
        0.6 * (1 - (embedding <=> ${queryEmbedding}::vector)) AS weighted_similarity,
        0.3 * (CASE WHEN title ILIKE '%' || ${query} || '%' THEN 1 ELSE 0 END) AS weighted_title,
        0.1 * (CASE WHEN "createdAt"::date = ${parsedDate}::date THEN 1 ELSE 0 END) AS weighted_date,
        0.6 * (1 - (embedding <=> ${queryEmbedding}::vector)) 
        + 0.3 * (CASE WHEN title ILIKE '%' || ${query} || '%' THEN 1 ELSE 0 END)
        + 0.1 * (CASE WHEN "createdAt"::date = ${parsedDate}::date THEN 1 ELSE 0 END) AS total_score
      FROM "Content"
      WHERE "userId" = ${userId}
      AND (
        0.6 * (1 - (embedding <=> ${queryEmbedding}::vector)) > ${similarityThreshold} 
        OR title ILIKE '%' || ${query} || '%' 
        OR "createdAt"::date = ${parsedDate}::date
      )
      ORDER BY total_score DESC
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
