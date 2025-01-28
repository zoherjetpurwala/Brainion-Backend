import { Request, Response } from "express";
import prisma from "../prisma.js";
import { generateEmbedding } from "../services/embedding.service.js";

export const createNote = async (req: Request, res: Response) => {
  try {
    const { title, content, userId } = req.body;

    if (!content)
      return res.status(400).json({ error: "Note content is required" });
    if (!title)
      return res.status(400).json({ error: "Note title is required" });
    const createdAt = new Date()
    const embedding = await generateEmbedding(createdAt + "\n" + content);
    const contentType = "NOTE";
    const note = await prisma.$executeRaw`
    INSERT INTO "Content" (id, title, content, embedding, "userId", "type", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid(),
      ${title}, 
      ${content}, 
      ${embedding}::vector, 
      ${userId}, 
      ${contentType}::"ContentType", -- Add the contentType here
      NOW(), 
      NOW()
    );
  `;

    res.status(201).json(note);
  } catch (error) {
    console.error("Error creating note:", error);
    res.status(500).json({ error: "Failed to create note" });
  }
};


export const deleteNote = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) return res.status(400).json({ error: "Note ID is required" });

    await prisma.content.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting note:", error);
    res.status(500).json({ error: "Failed to delete note" });
  }
};

