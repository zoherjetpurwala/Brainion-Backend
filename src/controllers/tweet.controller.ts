// import { Request, Response } from "express";
// import prisma from "../prisma.js";

// export const saveTweet = async (req: Request, res: Response) => {
//   try {
//     const { tweetId, content } = req.body;
//     const userId = req.user?.id;

//     const tweet = await prisma.tweet.create({
//       data: { tweetId, content, userId },
//     });

//     res.status(201).json(tweet);
//   } catch (error) {
//     res.status(500).json({ error: "Failed to save tweet" });
//   }
// };

// export const getTweets = async (req: Request, res: Response) => {
//   try {
//     const userId = req.user?.id;

//     const tweets = await prisma.tweet.findMany({
//       where: { userId },
//     });

//     res.status(200).json(tweets);
//   } catch (error) {
//     res.status(500).json({ error: "Failed to fetch tweets" });
//   }
// };
