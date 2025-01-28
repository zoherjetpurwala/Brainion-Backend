import { Request, Response } from "express";
import { processDocument } from "../services/document.service.js";
import { uploadToTebiStorage } from "../services/tebiStorage.service.js";
import prisma from "../prisma.js";

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Document file is required" });
    }
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Upload the file to Tebi Storage
    const tebiFileUrl = await uploadToTebiStorage(file);

    // Process document
    const { content, embedding, metadata } = await processDocument(file);
    const contentType = "DOCUMENT";

    const document = await prisma.$executeRaw`
      INSERT INTO "Content" (id, url, title, content, embedding, "userId", "type", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${tebiFileUrl},
        ${metadata.fileName},
        ${content},
        ${embedding}::vector,
        ${userId},
        ${contentType}::"ContentType", -- Add the contentType here
        NOW(),
        NOW()
      )
      RETURNING *;
    `;

    res.status(201).json(document);
  } catch (error) {
    console.error("Error uploading document:", error);
    res.status(500).json({
      error: "Failed to upload document",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
