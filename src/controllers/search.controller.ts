import { Request, Response } from "express";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as chrono from "chrono-node";

// Type definitions
interface SearchResult {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  type: string;
  url?: string;
  metadata?: any;
  weighted_similarity?: number;
  weighted_title?: number;
  weighted_date?: number;
  total_score?: number;
}

interface SearchParams {
  query: string;
  userId: string;
  similarityThreshold?: number;
  useAI?: boolean;
  limit?: number;
  contentTypes?: string[];
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Validation helper functions
const validateSearchInput = (query: string, userId: string) => {
  const errors: string[] = [];
  
  if (!query || typeof query !== 'string') {
    errors.push("Search query is required and must be a string");
  } else if (query.trim().length === 0) {
    errors.push("Search query cannot be empty");
  } else if (query.length > 1000) {
    errors.push("Search query is too long (max 1000 characters)");
  }
  
  if (!userId || typeof userId !== 'string') {
    errors.push("User ID is required and must be a string");
  } else if (userId.trim().length === 0) {
    errors.push("User ID cannot be empty");
  }
  
  return errors;
};

const sanitizeSearchQuery = (query: string): string => {
  // Remove potential SQL injection patterns and normalize
  return query
    .trim()
    .replace(/[%;\\]/g, '') // Remove common SQL injection chars
    .substring(0, 1000); // Limit length
};

// Simple title-based search function
export const searchByTitle = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check authentication
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { query, userId, limit = 10, contentTypes } = req.body;

    // Validate input
    const validationErrors = validateSearchInput(query, userId);
    if (validationErrors.length > 0) {
      res.status(400).json({ 
        error: "Validation failed", 
        details: validationErrors 
      });
      return;
    }

    // Validate limit
    const searchLimit = Math.min(Math.max(1, parseInt(limit) || 10), 50);

    // Validate content types
    const validContentTypes = ['NOTE', 'DOCUMENT', 'LINK'];
    let typeFilter: string[] = [];
    
    if (contentTypes && Array.isArray(contentTypes)) {
      typeFilter = contentTypes.filter(type => 
        validContentTypes.includes(type.toUpperCase())
      );
    }

    // Sanitize query
    const sanitizedQuery = sanitizeSearchQuery(query);

    // Build where clause
    const whereClause: any = {
      userId: userId.trim(),
      title: {
        contains: sanitizedQuery,
        mode: 'insensitive' as const
      }
    };

    if (typeFilter.length > 0) {
      whereClause.type = { in: typeFilter };
    }

    const results = await prisma.content.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        content: true,
        type: true,
        url: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [
        { createdAt: 'desc' },
        { title: 'asc' }
      ],
      take: searchLimit
    });

    if (results.length === 0) {
      res.status(200).json({ 
        success: true,
        results: [],
        total: 0,
        message: "No matching content found"
      });
      return;
    }

    res.status(200).json({
      success: true,
      results: results,
      total: results.length,
      query: sanitizedQuery,
      searchType: "title"
    });

  } catch (error) {
    console.error("Error searching by title:", error);
    
    if (error instanceof Error) {
      if (error.name === 'PrismaClientKnownRequestError') {
        res.status(400).json({ 
          error: "Database search failed",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        return;
      }
    }

    res.status(500).json({ 
      error: "Failed to search content",
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};

// Advanced search with AI capabilities
export const searchWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check authentication
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { 
      query, 
      userId, 
      similarityThreshold = 0.3, 
      useAI = true, 
      limit = 5,
      contentTypes,
      dateRange 
    }: SearchParams = req.body;

    // Validate input
    const validationErrors = validateSearchInput(query, userId);
    if (validationErrors.length > 0) {
      res.status(400).json({ 
        error: "Validation failed", 
        details: validationErrors 
      });
      return;
    }

    // Validate similarity threshold
    const threshold = Math.max(0.1, Math.min(1.0, parseFloat(similarityThreshold.toString()) || 0.3));

    // Validate limit
    const searchLimit = Math.min(Math.max(1, parseInt(limit.toString()) || 5), 20);

    // Validate Gemini API key if AI is requested
    if (useAI && !process.env.GEMINI_API_KEY) {
      res.status(500).json({ 
        error: "AI service not configured properly" 
      });
      return;
    }

    // Sanitize query
    const sanitizedQuery = sanitizeSearchQuery(query);

    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateEmbedding(sanitizedQuery);
    } catch (error) {
      console.error("Error generating embedding:", error);
      res.status(500).json({ 
        error: "Failed to process search query" 
      });
      return;
    }

    // Validate embedding
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      res.status(500).json({ error: "Invalid search embedding generated" });
      return;
    }

    // Parse date from query
    const parsedDate = chrono.parseDate(sanitizedQuery);
    const dateCondition = parsedDate ? parsedDate.toISOString().split('T')[0] : null;

    // Build the base query
    let whereConditions = [`"userId" = $1`];
    let paramIndex = 2;
    const queryParams: any[] = [userId.trim()];

    // Add content type filter if provided
    if (contentTypes && Array.isArray(contentTypes)) {
      const validContentTypes = ['NOTE', 'DOCUMENT', 'LINK'];
      const validTypes = contentTypes.filter(type => 
        validContentTypes.includes(type.toUpperCase())
      );
      if (validTypes.length > 0) {
        const typeParams = validTypes.map(() => `$${paramIndex++}`).join(',');
        whereConditions.push(`type IN (${typeParams})`);
        queryParams.push(...validTypes);
      }
    }

    // Add date range filter if provided
    if (dateRange?.start || dateRange?.end) {
      if (dateRange.start && dateRange.end) {
        whereConditions.push(`"createdAt" BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
        queryParams.push(dateRange.start.toISOString(), dateRange.end.toISOString());
        paramIndex += 2;
      } else if (dateRange.start) {
        whereConditions.push(`"createdAt" >= $${paramIndex}`);
        queryParams.push(dateRange.start.toISOString());
        paramIndex++;
      } else if (dateRange.end) {
        whereConditions.push(`"createdAt" <= $${paramIndex}`);
        queryParams.push(dateRange.end.toISOString());
        paramIndex++;
      }
    }

    // Add the main search conditions
    const embeddingParam = `$${paramIndex++}`;
    const queryParam = `$${paramIndex++}`;
    const thresholdParam = `$${paramIndex++}`;
    const limitParam = `$${paramIndex++}`;
    
    queryParams.push(queryEmbedding, sanitizedQuery, threshold, searchLimit);

    // Add date condition parameters if needed
    let dateConditionSql = '';
    if (dateCondition) {
      const dateParam = `$${paramIndex++}`;
      queryParams.push(dateCondition);
      dateConditionSql = `OR "createdAt"::date = ${dateParam}::date`;
    }

    const whereClause = whereConditions.join(' AND ');

    const sqlQuery = `
      SELECT 
        id,
        title, 
        content, 
        type,
        url,
        metadata,
        "createdAt",
        0.6 * (1 - (embedding <=> ${embeddingParam}::vector)) AS weighted_similarity,
        0.3 * (CASE WHEN title ILIKE '%' || ${queryParam} || '%' THEN 1 ELSE 0 END) AS weighted_title,
        0.1 * (CASE 
          WHEN ${dateCondition ? `${queryParams[queryParams.length - 1]}` : 'NULL'}::date IS NOT NULL AND "createdAt"::date = ${dateCondition ? `${queryParams[queryParams.length - 1]}` : 'NULL'}::date 
          THEN 1 
          ELSE 0 
        END) AS weighted_date,
        0.6 * (1 - (embedding <=> ${embeddingParam}::vector)) 
        + 0.3 * (CASE WHEN title ILIKE '%' || ${queryParam} || '%' THEN 1 ELSE 0 END)
        + 0.1 * (CASE 
          WHEN ${dateCondition ? `${queryParams[queryParams.length - 1]}` : 'NULL'}::date IS NOT NULL AND "createdAt"::date = ${dateCondition ? `${queryParams[queryParams.length - 1]}` : 'NULL'}::date 
          THEN 1 
          ELSE 0 
        END) AS total_score
      FROM "Content"
      WHERE ${whereClause}
      AND (
        0.6 * (1 - (embedding <=> ${embeddingParam}::vector)) > ${thresholdParam} 
        OR title ILIKE '%' || ${queryParam} || '%' 
        OR content ILIKE '%' || ${queryParam} || '%'
        ${dateConditionSql}
      )
      ORDER BY total_score DESC
      LIMIT ${limitParam};
    `;

    const results: SearchResult[] = await prisma.$queryRawUnsafe(sqlQuery, ...queryParams);

    if (results.length === 0) {
      res.status(200).json({ 
        success: true,
        results: [],
        total: 0,
        message: "No relevant content found",
        query: sanitizedQuery,
        searchType: "semantic"
      });
      return;
    }

    // If AI response is not requested, return results directly
    if (!useAI) {
      res.status(200).json({
        success: true,
        results: results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content,
          type: r.type,
          url: r.url,
          metadata: r.metadata,
          createdAt: r.createdAt,
          relevanceScore: r.total_score
        })),
        total: results.length,
        query: sanitizedQuery,
        searchType: "semantic"
      });
      return;
    }

    // Generate AI response if requested
    const topResult = results[0];
    
    if (!topResult.content || topResult.content.trim().length === 0) {
      res.status(200).json({
        success: true,
        results: results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content,
          type: r.type,
          url: r.url,
          metadata: r.metadata,
          createdAt: r.createdAt,
          relevanceScore: r.total_score
        })),
        total: results.length,
        query: sanitizedQuery,
        searchType: "semantic",
        message: "Found results but unable to generate AI response due to insufficient content"
      });
      return;
    }

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      // Truncate content if too long
      const maxContentLength = 4000;
      const truncatedContent = topResult.content.length > maxContentLength 
        ? topResult.content.substring(0, maxContentLength) + "..." 
        : topResult.content;

      const prompt = `
        Based on the following context, please answer the user's question clearly and concisely.
        Only use information from the provided context. If the context doesn't contain enough information to answer the question, say so.
        
        Context: ${truncatedContent}
        Question: ${sanitizedQuery}
        
        Answer:
      `;

      const result = await model.generateContent(prompt);
      const aiResponse = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!aiResponse) {
        throw new Error("No AI response generated");
      }

      res.status(200).json({
        success: true,
        query: sanitizedQuery,
        aiAnswer: aiResponse.trim(),
        sourceDocument: {
          id: topResult.id,
          title: topResult.title,
          type: topResult.type,
          relevanceScore: topResult.total_score
        },
        allResults: results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content.substring(0, 200) + (r.content.length > 200 ? "..." : ""),
          type: r.type,
          url: r.url,
          createdAt: r.createdAt,
          relevanceScore: r.total_score
        })),
        total: results.length,
        searchType: "ai-enhanced"
      });

    } catch (aiError) {
      console.error("Error generating AI response:", aiError);
      
      // Return search results even if AI fails
      res.status(200).json({
        success: true,
        results: results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content,
          type: r.type,
          url: r.url,
          metadata: r.metadata,
          createdAt: r.createdAt,
          relevanceScore: r.total_score
        })),
        total: results.length,
        query: sanitizedQuery,
        searchType: "semantic",
        warning: "AI response generation failed, returning search results only"
      });
    }

  } catch (error) {
    console.error("Error processing search:", error);
    
    if (error instanceof Error) {
      if (error.name === 'PrismaClientKnownRequestError') {
        res.status(400).json({ 
          error: "Database search failed",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        return;
      }

      if (error.message.includes('timeout')) {
        res.status(408).json({ 
          error: "Search request timeout" 
        });
        return;
      }
    }

    res.status(500).json({ 
      error: "Failed to process the search",
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};

// Health check for search services
export const searchHealthCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const checks = {
      database: false,
      embedding: false,
      ai: false
    };

    // Test database connection
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (error) {
      console.error("Database health check failed:", error);
    }

    // Test embedding service
    try {
      await generateEmbedding("test");
      checks.embedding = true;
    } catch (error) {
      console.error("Embedding service health check failed:", error);
    }

    // Test AI service
    try {
      if (process.env.GEMINI_API_KEY) {
        checks.ai = true;
      }
    } catch (error) {
      console.error("AI service health check failed:", error);
    }

    const allHealthy = Object.values(checks).every(check => check);

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "healthy" : "degraded",
      checks,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ 
      status: "unhealthy",
      error: "Health check failed" 
    });
  }
};