import { Request, Response } from "express";
import prisma from "../prisma.js";

export const getAllContent = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userId = req.query.userId as string;
    
    if (!userId) {
      res.status(400).json({ error: "User ID is required" });
      return;
    }

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      res.status(400).json({ error: "Invalid User ID format" });
      return;
    }

    const content = await prisma.content.findMany({
      where: { userId: userId.trim() },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        url: true,
        metadata: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      success: true,
      data: content,
      count: content.length
    });

  } catch (error) {
    console.error("Error fetching content:", error);
    
    if (error instanceof Error) {
      if (error.name === 'PrismaClientKnownRequestError') {
        res.status(400).json({ 
          error: "Database query failed",
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
    }

    res.status(500).json({ 
      error: "Failed to fetch content",
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};


export const deleteContent = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check authentication first
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { userId } = req.body; // Get userId from request body or token

    // Validate note ID
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: "Note ID is required and must be a string" });
      return;
    }

    if (id.trim().length === 0) {
      res.status(400).json({ error: "Note ID cannot be empty" });
      return;
    }

    // Optional: Validate UUID format (if using UUIDs)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({ error: "Invalid note ID format" });
      return;
    }

    // Check if note exists and belongs to the user (security check)
    const existingNote = await prisma.content.findFirst({
      where: { 
        id: id.trim(),
      },
      select: { 
        id: true, 
        userId: true, 
        title: true 
      }
    });

    if (!existingNote) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    // Optional: Verify ownership if userId is provided
    if (userId && existingNote.userId !== userId) {
      res.status(403).json({ error: "You don't have permission to delete this note" });
      return;
    }

    // Delete the note
    await prisma.content.delete({
      where: { id: id.trim() },
    });

    res.status(200).json({
      success: true,
      message: "Note deleted successfully",
      deletedNote: {
        id: existingNote.id,
        title: existingNote.title
      }
    });

  } catch (error) {
    console.error("Error deleting note:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.name === 'PrismaClientKnownRequestError') {
        // Handle record not found error
        if (error.message.includes('Record to delete does not exist')) {
          res.status(404).json({ error: "Note not found" });
          return;
        }
        
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
    }

    res.status(500).json({ 
      error: "Failed to delete note",
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};