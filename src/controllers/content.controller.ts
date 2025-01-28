import { Request, Response } from "express";
import prisma from "../prisma.js";

export const getAllContent = async (req: Request, res: Response) => {
    if (req.isAuthenticated()) {
      try {
        const userId = req.query.userId as string;
        
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