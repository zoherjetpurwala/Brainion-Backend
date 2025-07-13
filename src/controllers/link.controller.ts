import { Request, Response } from "express";
import puppeteer, { Browser } from "puppeteer";
import axios from "axios";
import { generateEmbedding } from "../services/embedding.service.js";
import prisma from "../prisma.js";

// Types for better type safety
interface LinkMetadata {
  title: string;
  content: string;
  thumbnail: string | null;
}

interface YouTubeApiResponse {
  items: Array<{
    snippet: {
      title: string;
      description: string;
      thumbnails: {
        high?: { url: string };
        medium?: { url: string };
        default?: { url: string };
      };
    };
  }>;
}

interface CreateLinkRequest {
  url: string;
  userId: string;
}

interface LinkResponse {
  id: string;
  url: string | null;
  title: string | null;
  content: string | null;
  metadata: any;
  userId: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

// Validate environment variables
if (!process.env.YOUTUBE_API_KEY) {
  console.warn("⚠️ YOUTUBE_API_KEY not found. YouTube metadata extraction will be limited.");
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Input validation
const validateCreateLinkInput = (body: any): { isValid: boolean; error?: string; data?: CreateLinkRequest } => {
  const { url, userId } = body;

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { isValid: false, error: "URL is required and must be a non-empty string" };
  }

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return { isValid: false, error: "User ID is required and must be a non-empty string" };
  }

  // Basic URL validation
  try {
    new URL(url.trim());
  } catch {
    return { isValid: false, error: "Invalid URL format" };
  }

  // Check URL length (reasonable limit)
  if (url.trim().length > 2000) {
    return { isValid: false, error: "URL too long (maximum 2000 characters)" };
  }

  return {
    isValid: true,
    data: {
      url: url.trim(),
      userId: userId.trim()
    }
  };
};

// URL type detection
const detectUrlType = (url: string): 'twitter' | 'youtube' | 'website' => {
  const normalizedUrl = url.toLowerCase();
  
  if (normalizedUrl.includes('twitter.com') || normalizedUrl.includes('x.com')) {
    return 'twitter';
  }
  
  if (normalizedUrl.includes('youtube.com/watch') || normalizedUrl.includes('youtu.be/')) {
    return 'youtube';
  }
  
  return 'website';
};

// Enhanced browser configuration
const createBrowserInstance = async (): Promise<Browser> => {
  try {
    return await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      timeout: 30000
    });
  } catch (error) {
    console.error("❌ Failed to launch browser:", error);
    throw new Error("Browser initialization failed");
  }
};

const fetchTwitterMetadata = async (url: string): Promise<LinkMetadata | null> => {
  let browser: Browser | null = null;
  
  try {
    console.log("🐦 Fetching Twitter metadata for:", url);
    
    browser = await createBrowserInstance();
    const page = await browser.newPage();

    // Set realistic browser headers
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1920, height: 1080 });

    // Set reasonable timeouts
    await page.goto(url, { 
      waitUntil: "domcontentloaded", 
      timeout: 30000 
    });

    // Wait for content to load
    await page.waitForSelector('body', { timeout: 10000 })

    const metadata = await page.evaluate(() => {
      // Multiple selectors for tweet content (Twitter UI changes frequently)
      const tweetSelectors = [
        "article div[data-testid='tweetText']",
        "article [data-testid='tweetText']",
        "div[data-testid='tweetText']",
        "article div[lang]"
      ];

      let tweetText = "No tweet content available";
      for (const selector of tweetSelectors) {
        const element = document.querySelector(selector);
        if (element?.textContent?.trim()) {
          tweetText = element.textContent.trim();
          break;
        }
      }

      // Multiple selectors for author
      const authorSelectors = [
        "article a[role='link'] span",
        "article [data-testid='User-Name'] span",
        "div[data-testid='User-Name'] span"
      ];

      let author = "Unknown author";
      for (const selector of authorSelectors) {
        const element = document.querySelector(selector);
        if (element?.textContent?.trim()) {
          author = element.textContent.trim();
          break;
        }
      }

      return {
        title: `Tweet by ${author}`,
        content: tweetText,
        thumbnail: null,
      };
    });

    console.log("✅ Twitter metadata extracted successfully");
    return metadata;
  } catch (error) {
    console.error("❌ Error fetching Twitter metadata:", error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const fetchYouTubeMetadata = async (url: string): Promise<LinkMetadata | null> => {
  try {
    console.log("📺 Fetching YouTube metadata for:", url);

    if (!YOUTUBE_API_KEY) {
      console.warn("⚠️ YouTube API key not available, falling back to web scraping");
      return await fetchYouTubeMetadataFallback(url);
    }

    // Extract video ID from various YouTube URL formats
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    const videoId = videoIdMatch?.[1];
    
    if (!videoId) {
      throw new Error("Invalid YouTube URL - could not extract video ID");
    }

    console.log(`🔍 Extracted video ID: ${videoId}`);

    const response = await axios.get<YouTubeApiResponse>(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          id: videoId,
          key: YOUTUBE_API_KEY,
          part: 'snippet'
        },
        timeout: 10000
      }
    );

    const video = response.data.items?.[0]?.snippet;
    if (!video) {
      throw new Error("YouTube video not found or private");
    }

    const thumbnail = video.thumbnails.high?.url || 
                     video.thumbnails.medium?.url || 
                     video.thumbnails.default?.url || 
                     null;

    console.log("✅ YouTube metadata extracted via API");
    return {
      title: video.title,
      content: video.description || "No description available",
      thumbnail
    };
  } catch (error) {
    console.error("❌ Error fetching YouTube metadata via API:", error);
    console.log("🔄 Falling back to web scraping");
    return await fetchYouTubeMetadataFallback(url);
  }
};

const fetchYouTubeMetadataFallback = async (url: string): Promise<LinkMetadata | null> => {
  let browser: Browser | null = null;
  
  try {
    browser = await createBrowserInstance();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('body', { timeout: 10000 })

    const metadata = await page.evaluate(() => {
      const title = document.querySelector('meta[name="title"]')?.getAttribute('content') ||
                   document.querySelector('title')?.textContent ||
                   "YouTube Video";

      const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                         "No description available";

      const thumbnail = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
                       null;

      return {
        title: title.replace(' - YouTube', ''),
        content: description,
        thumbnail
      };
    });

    console.log("✅ YouTube metadata extracted via fallback");
    return metadata;
  } catch (error) {
    console.error("❌ YouTube fallback extraction failed:", error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const fetchWebsiteMetadata = async (url: string): Promise<LinkMetadata | null> => {
  let browser: Browser | null = null;
  
  try {
    console.log("🌐 Fetching website metadata for:", url);
    
    browser = await createBrowserInstance();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1920, height: 1080 });

    // Set reasonable timeout
    await page.goto(url, { 
      waitUntil: "domcontentloaded", 
      timeout: 30000 
    });

    await page.waitForSelector('body', { timeout: 10000 })

    const metadata = await page.evaluate((pageUrl) => {
      // Get title from multiple sources
      const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                   document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
                   document.querySelector('title')?.textContent ||
                   document.querySelector('h1')?.textContent ||
                   "Untitled";

      // Get description/content
      const description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                         document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                         document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ||
                         "";

      // Get body text if no description (limit to reasonable length)
      let content = description;
      if (!content || content.length < 50) {
        const bodyText = document.body.innerText?.trim() || "";
        content = bodyText.length > 1000 ? bodyText.substring(0, 1000) + "..." : bodyText;
      }

      // Get thumbnail with fallbacks
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
      const twitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
      const favicon = document.querySelector('link[rel="icon"]')?.getAttribute('href') ||
                     document.querySelector('link[rel="shortcut icon"]')?.getAttribute('href');
      const firstImg = document.querySelector('img')?.getAttribute('src');

      const makeAbsoluteUrl = (imgUrl?: string | null): string | null => {
        if (!imgUrl) return null;
        try {
          return imgUrl.startsWith('http') ? imgUrl : new URL(imgUrl, pageUrl).href;
        } catch {
          return null;
        }
      };

      const thumbnail = makeAbsoluteUrl(ogImage) ||
                       makeAbsoluteUrl(twitterImage) ||
                       makeAbsoluteUrl(favicon) ||
                       makeAbsoluteUrl(firstImg);

      return {
        title: title.trim(),
        content: content.trim() || "No content available",
        thumbnail
      };
    }, url);

    console.log("✅ Website metadata extracted successfully");
    return metadata;
  } catch (error) {
    console.error("❌ Error fetching website metadata:", error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

export const createLink = async (request: Request, response: Response): Promise<void> => {
  try {
    const validation = validateCreateLinkInput(request.body);
    
    if (!validation.isValid) {
      response.status(400).json({ error: validation.error });
      return;
    }

    const { url, userId } = validation.data!;

    console.log(`🔗 Creating link for user ${userId}: ${url}`);

    // Detect URL type and fetch appropriate metadata
    const urlType = detectUrlType(url);
    console.log(`📋 Detected URL type: ${urlType}`);

    let metadata: LinkMetadata | null = null;

    try {
      switch (urlType) {
        case 'twitter':
          metadata = await fetchTwitterMetadata(url);
          break;
        case 'youtube':
          metadata = await fetchYouTubeMetadata(url);
          break;
        case 'website':
          metadata = await fetchWebsiteMetadata(url);
          break;
      }
    } catch (metadataError) {
      console.error(`❌ Error fetching ${urlType} metadata:`, metadataError);
      metadata = null;
    }

    if (!metadata) {
      response.status(400).json({ 
        error: "Could not fetch metadata from the provided URL",
        urlType,
        suggestions: [
          "Check if the URL is accessible",
          "Ensure the website is not blocking automated access",
          "Try again later if the service is temporarily unavailable"
        ]
      });
      return;
    }

    if (!metadata.title || metadata.title.trim().length === 0) {
      response.status(400).json({ 
        error: "Could not extract title from the URL",
        urlType 
      });
      return;
    }

    console.log(`✅ Metadata extracted: "${metadata.title.substring(0, 50)}..."`);

    // Generate embedding for search functionality
    let embedding: number[];
    try {
      const createdAt = new Date();
      const embeddingText = `title: ${metadata.title}\nDate: ${createdAt.toISOString()}\nContent: ${metadata.content}`;
      embedding = await generateEmbedding(embeddingText);
      console.log(`✅ Generated embedding with ${embedding.length} dimensions`);
    } catch (embeddingError) {
      console.error("❌ Failed to generate embedding:", embeddingError);
      response.status(500).json({ error: "Failed to process link content for search indexing" });
      return;
    }

    // Create link using Prisma ORM for better type safety
    let createdLink: LinkResponse;
    try {
      const metadataJson = { 
        thumbnail: metadata.thumbnail,
        urlType,
        extractedAt: new Date().toISOString()
      };

      // First create the content without embedding
      createdLink = await prisma.content.create({
        data: {
          url,
          title: metadata.title,
          content: metadata.content,
          metadata: metadataJson,
          userId,
          type: "LINK"
        },
        select: {
          id: true,
          url: true,
          title: true,
          content: true,
          metadata: true,
          userId: true,
          type: true,
          createdAt: true,
          updatedAt: true
        }
      });

      // Update with embedding using raw SQL (if your schema supports it)
      if (embedding) {
        try {
          await prisma.$executeRaw`
            UPDATE "Content" 
            SET embedding = ${embedding}::vector 
            WHERE id = ${createdLink.id}
          `;
          console.log(`✅ Embedding added to link ${createdLink.id}`);
        } catch (embeddingUpdateError) {
          console.warn("⚠️ Failed to add embedding, but link created successfully:", embeddingUpdateError);
        }
      }

      console.log(`✅ Link created successfully with ID: ${createdLink.id}`);
    } catch (dbError) {
      console.error("❌ Database error during link creation:", dbError);
      
      if (dbError instanceof Error) {
        if (dbError.message.includes('foreign key constraint')) {
          response.status(400).json({ error: "Invalid user ID provided" });
          return;
        }
        
        if (dbError.message.includes('duplicate key') || dbError.message.includes('unique constraint')) {
          response.status(409).json({ error: "This link has already been saved" });
          return;
        }

        if (dbError.message.includes('vector')) {
          response.status(500).json({ error: "Search indexing failed. Vector database not available." });
          return;
        }
      }
      
      response.status(500).json({ error: "Failed to save link to database" });
      return;
    }

    response.status(201).json({
      success: true,
      message: "Link created successfully",
      data: createdLink,
      metadata: {
        urlType,
        embeddingGenerated: true,
        searchable: true,
        thumbnailExtracted: !!metadata.thumbnail
      }
    });
  } catch (error) {
    console.error("❌ Unexpected error in createLink:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    response.status(500).json({ 
      error: "Failed to create link", 
      details: errorMessage 
    });
  }
};