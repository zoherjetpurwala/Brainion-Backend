import { Request, Response } from "express";
import { processDocument } from "../services/document.service.js";
import { uploadToTebiStorage } from "../services/tebiStorage.service.js";
import prisma from "../prisma.js";

export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { userId } = req.body;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "Document file is required" });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: "User ID is required" });
      return;
    }

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      res.status(400).json({ error: "Invalid User ID format" });
      return;
    }

    if (!file.originalname || !file.buffer) {
      res.status(400).json({ error: "Invalid file format" });
      return;
    }

    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxFileSize) {
      res.status(400).json({ error: "File size too large. Maximum 50MB allowed" });
      return;
    }

    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ];
    
    if (!allowedMimeTypes.includes(file.mimetype)) {
      res.status(400).json({ 
        error: "Unsupported file type",
        supportedTypes: allowedMimeTypes
      });
      return;
    }

    let tebiFileUrl: string;
    let processedData: { content: string; embedding: number[]; metadata: any };

    try {
      tebiFileUrl = await uploadToTebiStorage(file);
    } catch (error) {
      console.error("Error uploading to Tebi Storage:", error);
      res.status(500).json({ 
        error: "Failed to upload file to storage",
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
      return;
    }

    try {
      processedData = await processDocument(file);
    } catch (error) {
      console.error("Error processing document:", error);
      res.status(500).json({ 
        error: "Failed to process document",
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
      return;
    }

    const { content, embedding, metadata } = processedData;

    if (!content || !embedding || !metadata) {
      res.status(500).json({ error: "Document processing returned invalid data" });
      return;
    }

    if (!Array.isArray(embedding) || embedding.length === 0) {
      res.status(500).json({ error: "Invalid embedding data" });
      return;
    }

    if (!metadata.fileName) {
      metadata.fileName = file.originalname;
    }

    const contentType = "DOCUMENT";

    const document = await prisma.$queryRaw`
      WITH inserted AS (
        INSERT INTO "Content" (id, url, title, content, embedding, "userId", "type", "createdAt", "updatedAt", metadata)
        VALUES (
          gen_random_uuid(),
          ${tebiFileUrl},
          ${metadata.fileName},
          ${content},
          ${embedding}::vector,
          ${userId.trim()},
          ${contentType}::"ContentType",
          NOW(),
          NOW(),
          ${JSON.stringify(metadata)}::jsonb
        )
        RETURNING *
      )
      SELECT 
        id,
        url,
        title,
        content,
        "userId",
        type,
        metadata,
        "createdAt",
        "updatedAt"
      FROM inserted;
    `;

    const insertedDocument = Array.isArray(document) ? document[0] : document;

    if (!insertedDocument) {
      res.status(500).json({ error: "Failed to create document record" });
      return;
    }

    res.status(201).json({
      success: true,
      data: insertedDocument,
      message: "Document uploaded and processed successfully"
    });

  } catch (error) {
    console.error("Error uploading document:", error);
    
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

      if (error.message.includes('duplicate key')) {
        res.status(409).json({ 
          error: "Document already exists" 
        });
        return;
      }

      if (error.message.includes('foreign key constraint')) {
        res.status(400).json({ 
          error: "Invalid user ID or data references" 
        });
        return;
      }
    }

    res.status(500).json({
      error: "Failed to upload document",
      details: process.env.NODE_ENV === 'development' ? error : undefined,
    });
  }
};