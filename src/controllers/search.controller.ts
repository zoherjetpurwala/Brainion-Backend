import { Request, Response } from "express";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as chrono from "chrono-node";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Simple title-based search function
export const searchByTitle = async (req: Request, res: Response) => {
  try {
    const { query, userId } = req.body;

    if (!query) return res.status(400).json({ error: "Search query is required" });
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const results = await prisma.content.findMany({
      where: {
        userId,
        title: {
          contains: query,
          mode: 'insensitive'
        }
      },
      select: {
        title: true,
        content: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    if (results.length === 0) {
      return res.status(404).json({ error: "No matching content found" });
    }

    res.status(200).json({
      results
    });
  } catch (error) {
    console.error("Error searching by title:", error);
    res.status(500).json({ error: "Failed to search content" });
  }
};

// Advanced search with AI capabilities
export const searchWithAI = async (req: Request, res: Response) => {
  try {
    const { query, userId, similarityThreshold = 0.3, useAI = true } = req.body;

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

    // If AI response is not requested, return results directly
    if (!useAI) {
      return res.status(200).json({
        results
      });
    }

    // Generate AI response if requested
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
    console.error("Error processing search:", error);
    res.status(500).json({ error: "Failed to process the search" });
  }
};