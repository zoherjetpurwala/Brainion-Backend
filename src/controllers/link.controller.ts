import { Request, Response } from "express";
import puppeteer from "puppeteer";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";

const fetchTwitterMetadata = async (url: string) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector("body"); // Ensure body is available

  const metadata = await page.evaluate(() => {
    const tweetText =
      document
        .querySelector("article div[data-testid='tweetText']")
        ?.textContent?.trim() || "No tweet content available";
    const author =
      document
        .querySelector("article a[role='link'] span")
        ?.textContent?.trim() || "Unknown author";

    return {
      title: `Tweet by ${author}`,
      content: tweetText,
    };
  });

  await browser.close();
  return metadata;
};

const fetchWebsiteMetadata = async (url: string) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const metadata = await page.evaluate(() => {
    const title = document.title || "No title available";
    const bodyText = document.body.innerText?.trim() || "";
    return { title, content: bodyText };
  });

  await browser.close();
  return metadata;
};

export const createLink = async (request: Request, response: Response) => {
  try {
    const { url, userId } = request.body;

    let metadata;
    if (url.includes("twitter.com") || url.includes("x.com")) {
      metadata = await fetchTwitterMetadata(url);
    } else {
      metadata = await fetchWebsiteMetadata(url);
    }

    if (!metadata) {
      return response.status(400).json({ error: "Could not fetch metadata" });
    }

    if (!metadata.title) {
      return response
        .status(400)
        .json({ error: "Could not fetch metadata title" });
    }

    const createdAt = new Date();
    const embedding = await generateEmbedding(
      `title: ${metadata.title}\nDate: ${createdAt}\nContent: ${metadata.content}`
    );

    const contentType = "DOCUMENT";
    const note = await prisma.$executeRaw`
      INSERT INTO "Content" (id, url, title, content, embedding, "userId", "type", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${url},
        ${metadata.title},
        ${metadata.content},
        ${embedding}::vector,
        ${userId},
        ${contentType}::"ContentType", -- Add the contentType here
        NOW(),
        NOW()
      )
      RETURNING *;
    `;

    response.status(201).json(note);
  } catch (error: any) {
    console.error("Error creating link:", error);
    response.status(500).json({ error: "Failed to create link" });
  }
};
