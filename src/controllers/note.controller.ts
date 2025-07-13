import { Request, Response } from "express";
import prisma from "../prisma.js";
import { generateEmbedding } from "../services/embedding.service.js";

export const createNote = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check authentication first
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { title, content, userId } = req.body;

    // Validate required fields
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: "Note content is required and must be a string" });
      return;
    }

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: "Note title is required and must be a string" });
      return;
    }

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: "User ID is required and must be a string" });
      return;
    }

    // Validate input lengths
    if (title.trim().length === 0) {
      res.status(400).json({ error: "Note title cannot be empty" });
      return;
    }

    if (content.trim().length === 0) {
      res.status(400).json({ error: "Note content cannot be empty" });
      return;
    }

    if (title.length > 500) {
      res.status(400).json({ error: "Note title is too long (max 500 characters)" });
      return;
    }

    if (content.length > 50000) {
      res.status(400).json({ error: "Note content is too long (max 50,000 characters)" });
      return;
    }

    // Check if user exists (optional but recommended)
    const userExists = await prisma.user.findUnique({
      where: { id: userId.trim() },
      select: { id: true }
    });

    if (!userExists) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    // Check for duplicate notes (optional)
    const existingNote = await prisma.content.findFirst({
      where: {
        title: title.trim(),
        userId: userId.trim(),
        type: "NOTE"
      },
      select: { id: true }
    });

    if (existingNote) {
      res.status(409).json({ 
        error: "A note with this title already exists",
        existingNoteId: existingNote.id
      });
      return;
    }

    const createdAt = new Date();
    
    // Generate embedding with better text formatting
    const embeddingText = [
      `Title: ${title.trim()}`,
      `Date: ${createdAt.toISOString()}`,
      `Content: ${content.trim()}`
    ].join('\n');

    let embedding: number[];
    try {
      embedding = await generateEmbedding(embeddingText);
    } catch (error) {
      console.error("Error generating embedding:", error);
      res.status(500).json({ 
        error: "Failed to process note content",
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
      return;
    }

    // Validate embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      res.status(500).json({ error: "Invalid embedding generated" });
      return;
    }

    const contentType = "NOTE";

    // Use $queryRaw instead of $executeRaw to return the created record
    const note = await prisma.$queryRaw`
      WITH inserted AS (
        INSERT INTO "Content" (id, title, content, embedding, "userId", "type", "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid(),
          ${title.trim()}, 
          ${content.trim()}, 
          ${embedding}::vector, 
          ${userId.trim()}, 
          ${contentType}::"ContentType",
          NOW(), 
          NOW()
        )
        RETURNING *
      )
      SELECT 
        id,
        title,
        content,
        "userId",
        type,
        "createdAt",
        "updatedAt"
      FROM inserted;
    `;

    // Handle the result array from queryRaw
    const createdNote = Array.isArray(note) ? note[0] : note;

    if (!createdNote) {
      res.status(500).json({ error: "Failed to create note record" });
      return;
    }

    res.status(201).json({
      success: true,
      data: createdNote,
      message: "Note created successfully"
    });

  } catch (error) {
    console.error("Error creating note:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.name === 'PrismaClientKnownRequestError') {
        res.status(400).json({ 
          error: "Database operation failed",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        return;
      }
      
      if (error.name === 'PrismaClientUnknownRequestError') {
        res.status(500).json({ 
          error: "Unknown database error occurred" 
        });
        return;
      }

      if (error.name === 'PrismaClientValidationError') {
        res.status(400).json({ 
          error: "Invalid data provided",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        return;
      }

      // Handle foreign key constraint errors
      if (error.message.includes('foreign key constraint')) {
        res.status(400).json({ 
          error: "Invalid user ID or data references" 
        });
        return;
      }

      // Handle duplicate key errors
      if (error.message.includes('duplicate key')) {
        res.status(409).json({ 
          error: "Note with this title already exists" 
        });
        return;
      }
    }

    res.status(500).json({ 
      error: "Failed to create note",
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};


// Optional: Get note by ID for verification
export const getNoteById = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { userId } = req.query;

    if (!id) {
      res.status(400).json({ error: "Note ID is required" });
      return;
    }

    const note = await prisma.content.findFirst({
      where: { 
        id: id.trim(),
        type: "NOTE",
        ...(userId && { userId: userId as string })
      },
      select: {
        id: true,
        title: true,
        content: true,
        userId: true,
        type: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: note
    });

  } catch (error) {
    console.error("Error fetching note:", error);
    res.status(500).json({ 
      error: "Failed to fetch note",
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};