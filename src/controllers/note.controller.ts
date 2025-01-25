import { Request, Response } from "express";
import prisma from "../prisma.js";
import { generateEmbedding } from "../services/embedding.service.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const createNote = async (req: Request, res: Response) => {
  try {
    const { title, content, tags, userId } = req.body;

    if (!content)
      return res.status(400).json({ error: "Note content is required" });
    if (!title)
      return res.status(400).json({ error: "Note title is required" });
    const createdAt = new Date()
    const embedding = await generateEmbedding(createdAt + "\n" + content);
    const contentType = "NOTE";
    const note = await prisma.$executeRaw`
    INSERT INTO "Content" (id, title, content, tags, embedding, "userId", "type", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid(),
      ${title}, 
      ${content}, 
      ARRAY[${tags}]::text[], 
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

export const getNotes = async (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    try {
      const userId = req.query.userId as string;

      console.log(userId);

      if (!userId)
        return res.status(400).json({ error: "User ID is required" });

      const notes = await prisma.content.findMany({
        where: { userId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          title: true,
          content: true,
          url: true,
          createdAt: true,
        },
      });

      res.status(200).json(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  } else {
    res.status(401).send("Unauthorized");
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

export const askQuestion = async (req: Request, res: Response) => {
  try {
    const { contentType, query, userId, similarityThreshold = 0.3 } = req.body;

    if (!query) return res.status(400).json({ error: "Question is required" });
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const queryEmbedding = await generateEmbedding(query);

    const results: any = await prisma.$queryRaw`
      SELECT title, content, "createdAt" , 1 - (embedding <=> ${queryEmbedding}::vector) AS cosine_similarity
      FROM "Content"
      WHERE "userId" = ${userId}
      AND "type" = ${contentType.toUpperCase()}::"ContentType"
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
