import { Request, Response } from "express";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as chrono from "chrono-node";

// Validate environment variables on startup
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Types for better type safety
interface SearchQuery {
  query: string;
  userId: string;
  similarityThreshold?: number;
  useAI?: boolean;
}

interface ContentResult {
  title: string;
  content: string;
  createdAt: Date;
  weighted_similarity?: number;
  weighted_title?: number;
  weighted_date?: number;
  total_score?: number;
}

// Input validation helper
const validateSearchInput = (body: any): { isValid: boolean; error?: string; data?: SearchQuery } => {
  const { query, userId, similarityThreshold = 0.3, useAI = true } = body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { isValid: false, error: "Search query is required and must be a non-empty string" };
  }

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return { isValid: false, error: "User ID is required and must be a non-empty string" };
  }

  if (typeof similarityThreshold !== 'number' || similarityThreshold < 0 || similarityThreshold > 1) {
    return { isValid: false, error: "Similarity threshold must be a number between 0 and 1" };
  }

  if (typeof useAI !== 'boolean') {
    return { isValid: false, error: "useAI must be a boolean value" };
  }

  return {
    isValid: true,
    data: {
      query: query.trim(),
      userId: userId.trim(),
      similarityThreshold,
      useAI
    }
  };
};

// Simple title-based search function
export const searchByTitle = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = validateSearchInput(req.body);
    
    if (!validation.isValid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { query, userId } = validation.data!;

    console.log(`🔍 Title search for user ${userId}: "${query}"`);

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

    console.log(`📊 Found ${results.length} results for title search`);

    if (results.length === 0) {
      res.status(404).json({ 
        error: "No matching content found",
        query,
        searchType: "title"
      });
      return;
    }

    res.status(200).json({
      results,
      totalFound: results.length,
      searchType: "title",
      query
    });
  } catch (error) {
    console.error("❌ Error in searchByTitle:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: "Failed to search content", details: errorMessage });
  }
};

// Advanced search with AI capabilities
export const searchWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = validateSearchInput(req.body);
    
    if (!validation.isValid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { query, userId, similarityThreshold, useAI } = validation.data!;

    console.log(`🤖 AI search for user ${userId}: "${query}" (useAI: ${useAI})`);

    // Generate embedding for the query
    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateEmbedding(query);
      console.log(`✅ Generated embedding with ${queryEmbedding.length} dimensions`);
    } catch (embeddingError) {
      console.error("❌ Failed to generate embedding:", embeddingError);
      res.status(500).json({ error: "Failed to process query for semantic search" });
      return;
    }

    // Parse date from query (safe parsing)
    let parsedDate: Date | null = null;
    try {
      parsedDate = chrono.parseDate(query);
      if (parsedDate) {
        console.log(`📅 Parsed date from query: ${parsedDate.toISOString()}`);
      }
    } catch (dateError) {
      console.warn("⚠️ Date parsing failed, continuing without date filter:", dateError);
    }

    // Execute database query with better error handling
    let results: ContentResult[];
    try {
      results = await prisma.$queryRaw`
        SELECT title, content, "createdAt",
          0.6 * (1 - (embedding <=> ${queryEmbedding}::vector)) AS weighted_similarity,
          0.3 * (CASE WHEN title ILIKE '%' || ${query} || '%' THEN 1 ELSE 0 END) AS weighted_title,
          0.1 * (CASE WHEN ${parsedDate}::date IS NOT NULL AND "createdAt"::date = ${parsedDate}::date THEN 1 ELSE 0 END) AS weighted_date,
          0.6 * (1 - (embedding <=> ${queryEmbedding}::vector)) 
          + 0.3 * (CASE WHEN title ILIKE '%' || ${query} || '%' THEN 1 ELSE 0 END)
          + 0.1 * (CASE WHEN ${parsedDate}::date IS NOT NULL AND "createdAt"::date = ${parsedDate}::date THEN 1 ELSE 0 END) AS total_score
        FROM "Content"
        WHERE "userId" = ${userId}
        AND (
          0.6 * (1 - (embedding <=> ${queryEmbedding}::vector)) > ${similarityThreshold} 
          OR title ILIKE '%' || ${query} || '%' 
          OR (${parsedDate}::date IS NOT NULL AND "createdAt"::date = ${parsedDate}::date)
        )
        ORDER BY total_score DESC
        LIMIT 3;
      `;
      
      console.log(`📊 Found ${results.length} results from database`);
    } catch (dbError) {
      console.error("❌ Database query failed:", dbError);
      
      // Check if it's a vector extension issue
      if (dbError instanceof Error && dbError.message.includes('operator does not exist')) {
        res.status(500).json({ 
          error: "Vector search not available. Please ensure pgvector extension is installed." 
        });
        return;
      }
      
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    if (results.length === 0) {
      console.log("❌ No relevant content found");
      res.status(404).json({ 
        error: "No relevant content found",
        query,
        searchType: "ai_semantic",
        suggestions: [
          "Try using different keywords",
          "Check if the content exists in your database",
          "Lower the similarity threshold"
        ]
      });
      return;
    }

    // If AI response is not requested, return results directly
    if (!useAI) {
      console.log("📤 Returning semantic search results without AI generation");
      res.status(200).json({
        results,
        totalFound: results.length,
        searchType: "semantic",
        query,
        similarityThreshold
      });
      return;
    }

    // Generate AI response
    try {
      const relevantContent = results[0].content;
      const getTitle = results[0].title;

      if (!relevantContent || relevantContent.trim().length === 0) {
        console.warn("⚠️ No content available for AI generation");
        res.status(200).json({
          title: getTitle,
          answer: "Content found but no text available for AI analysis.",
          listOfNotes: results,
          searchType: "ai_semantic",
          query
        });
        return;
      }

      console.log("🤖 Generating AI response...");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `Based on the following context, answer the user's question clearly and concisely. Only use information from the provided context.

Context: ${relevantContent.slice(0, 8000)} ${relevantContent.length > 8000 ? '...' : ''}

Question: ${query}

Instructions:
- Answer only based on the provided context
- Be clear and concise
- If the context doesn't contain enough information to answer the question, state that clearly
- Do not make up information not present in the context`;

      const result = await model.generateContent(prompt);
      
      if (!result?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.warn("⚠️ AI generated empty response");
        res.status(200).json({
          title: getTitle,
          answer: "I found relevant content but couldn't generate a specific answer to your question.",
          listOfNotes: results,
          searchType: "ai_semantic",
          query
        });
        return;
      }

      const aiAnswer = result.response.candidates[0].content.parts[0].text;
      console.log(`✅ AI response generated (${aiAnswer.length} characters)`);

      res.status(200).json({
        title: getTitle,
        answer: aiAnswer,
        listOfNotes: results,
        searchType: "ai_semantic",
        query,
        similarityThreshold,
        metadata: {
          contentLength: relevantContent.length,
          totalResults: results.length,
          aiModel: "gemini-1.5-flash"
        }
      });
    } catch (aiError) {
      console.error("❌ AI generation failed:", aiError);
      
      // Gracefully degrade to returning search results without AI
      res.status(200).json({
        title: results[0].title,
        answer: "Found relevant content but AI response generation failed. Please see the content below.",
        listOfNotes: results,
        searchType: "semantic_fallback",
        query,
        warning: "AI generation temporarily unavailable"
      });
    }
  } catch (error) {
    console.error("❌ Unexpected error in searchWithAI:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ 
      error: "Failed to process the search", 
      details: errorMessage,
      query: req.body?.query || 'unknown'
    });
  }
};