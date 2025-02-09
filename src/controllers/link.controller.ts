import { Request, Response } from "express";
import puppeteer from "puppeteer";
import axios from "axios";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";

type YouTubeApiResponse = {
  items: { snippet: { title: string; description: string; thumbnails: { high?: { url: string } } } }[];
};

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const fetchTwitterMetadata = async (url: string) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("body");

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
      thumbnail: null,
    };
  });

  await browser.close();
  return metadata;
};

const fetchYouTubeMetadata = async (url: string) => {
  try {
    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
    if (!videoId) throw new Error("Invalid YouTube URL");

    console.log(videoId);
    

    const response = await axios.get<YouTubeApiResponse>(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${YOUTUBE_API_KEY}&part=snippet`
    );

    const video = response.data.items[0]?.snippet;
    if (!video) throw new Error("YouTube metadata not found");

    return {
      title: video.title,
      content: video.description,
      thumbnail: video.thumbnails.high?.url || null,
    };
  } catch (error) {
    console.error("Error fetching YouTube metadata:", error);
    return null;
  }
};

const fetchWebsiteMetadata = async (url: string) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("body");

  const metadata = await page.evaluate(() => {
    const title = document.title || "No title available";
    const bodyText = document.body.innerText?.trim() || "";

    const ogImage = document.querySelector("meta[property='og:image']")?.getAttribute("content");
    const favicon = document.querySelector("link[rel='icon']")?.getAttribute("href") ||
      document.querySelector("link[rel='shortcut icon']")?.getAttribute("href");
    const firstImg = document.querySelector("img")?.getAttribute("src");

    const absoluteUrl = (imgUrl?: string | null): string | null => {
      if (!imgUrl) return null;
      return imgUrl.startsWith("http")
        ? imgUrl
        : new URL(imgUrl, window.location.origin).href;
    };

    return {
      title,
      content: bodyText,
      thumbnail:
        absoluteUrl(ogImage) ||
        absoluteUrl(favicon) ||
        absoluteUrl(firstImg) ||
        null,
    };
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
    } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      metadata = await fetchYouTubeMetadata(url);
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

    const contentType = "LINK";
    const metadataJson = { thumbnail: metadata.thumbnail };
    const note = await prisma.$executeRaw`
      INSERT INTO "Content" (id, url, metadata, title, content, embedding, "userId", "type", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${url},
        ${JSON.stringify(metadataJson)}::jsonb,
        ${metadata.title},
        ${metadata.content},
        ${embedding}::vector,
        ${userId},
        ${contentType}::"ContentType",
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