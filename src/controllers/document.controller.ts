import { Request, Response } from "express";
import { processDocument } from "../services/document.service.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToTebiStorage } from "../services/tebiStorage.service.js";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

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
    console.log(content);
    

    const document = await prisma.$executeRaw`
      INSERT INTO "Content" (id, "url", title, content, embedding, "userId", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${tebiFileUrl},
        ${metadata.fileName}
        ${content},
        ${embedding}::vector,
        ${userId},
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
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getDocuments = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const content = await prisma.content.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(content);
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
};

export const askQuestion = async (req: Request, res: Response) => {
  try {
    const { query, userId } = req.body;

    if (!query) return res.status(400).json({ error: "Question is required" });
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const queryEmbedding = await generateEmbedding(query);

    const results: any = await prisma.$queryRaw`
      SELECT id, content, (embedding <-> ${queryEmbedding}::vector) AS distance
      FROM "Document"
      WHERE "userId" = ${userId}
      ORDER BY distance ASC
      LIMIT 5;
    `;

    if (results.length === 0) {
      return res.status(404).json({ error: "No relevant content found" });
    }

    const relevantContent = results[0].content;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
      Context: ${relevantContent}
      Question: ${query}
      Answer in a clear and concise manner just based on the context given.
    `;
    const result = await model.generateContent(prompt);

    const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

    res.status(200).json({
      answer: text,
      relevantDocument: results[0],
      listOfDocuments: results,
    });
  } catch (error) {
    console.error("Error answering question:", error);
    res.status(500).json({ error: "Failed to process the question" });
  }
};
