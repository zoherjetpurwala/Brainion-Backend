import axios from "axios";
import prisma from "../prisma.js";
import { Cron } from "croner";

const fetchAndStoreQuote = async () => {
  try {
    const response = await axios.get(
      "https://quotes-api-self.vercel.app/quote"
    );
    const newQuote = response.data.quote;

    await prisma.quote.deleteMany({});

    await prisma.quote.create({
      data: {
        quote: newQuote,
      },
    });
  } catch (error) {
    console.error("Error fetching quote:", error);
  }
};

new Cron("0 0 * * *", fetchAndStoreQuote);

fetchAndStoreQuote();
