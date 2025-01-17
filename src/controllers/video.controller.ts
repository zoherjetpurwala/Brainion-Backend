// import { Request, Response } from "express";
// import prisma from "../prisma.js";
// import { extractVideoData } from "../services/video.service.js";

// export const saveVideo = async (req: Request, res: Response) => {
//   try {
//     const { videoUrl } = req.body;
//     const userId = req.user?.id;

//     const videoData = await extractVideoData(videoUrl);

//     const video = await prisma.youTubeVideo.create({
//       data: { ...videoData, userId },
//     });

//     res.status(201).json(video);
//   } catch (error) {
//     res.status(500).json({ error: "Failed to save video" });
//   }
// };

// export const getVideos = async (req: Request, res: Response) => {
//   try {
//     const userId = req.user?.id;

//     const videos = await prisma.video.findMany({
//       where: { userId },
//     });

//     res.status(200).json(videos);
//   } catch (error) {
//     res.status(500).json({ error: "Failed to fetch videos" });
//   }
// };
