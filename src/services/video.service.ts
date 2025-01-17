import axios from "axios";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

export const extractVideoData = async (videoUrl: string) => {
  try {
    const videoId = new URL(videoUrl).searchParams.get("v");

    if (!videoId) throw new Error("Invalid YouTube URL");

    const response = await axios.get(YOUTUBE_API_URL, {
      params: {
        id: videoId,
        part: "snippet,contentDetails",
        key: YOUTUBE_API_KEY,
      },
    });

    if (response.status !== 200 || !response.data.items[0]) {
      throw new Error("Failed to fetch video data");
    }

    const video = response.data.items[0];
    return {
      title: video.snippet.title,
      description: video.snippet.description,
      publishedAt: video.snippet.publishedAt,
      duration: video.contentDetails.duration,
    };
  } catch (error: any) {
    console.error("Error extracting video data:", error.message);
    throw new Error("Failed to extract video data");
  }
};
