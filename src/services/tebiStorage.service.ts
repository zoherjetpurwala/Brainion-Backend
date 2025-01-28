import { S3 } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const s3 = new S3({
  endpoint: process.env.TEBI_ENDPOINT as string,
  region: process.env.TEBI_REGION as string,
  credentials: {
    accessKeyId: process.env.TEBI_ACCESS_KEY as string,
    secretAccessKey: process.env.TEBI_SECRET_KEY as string,
  },
  forcePathStyle: true,
});

export const uploadToTebiStorage = async (file: Express.Multer.File) => {
  const fileKey = `documents/${Date.now()}-${file.originalname.replace(
    /[^a-zA-Z0-9.-]/g,
    "_"
  )}`;

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: process.env.TEBI_BUCKET_NAME,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentLength: file.size,
      ACL: "public-read",
    },
  });

  await upload.done();
  return `${process.env.TEBI_ENDPOINT}/${process.env.TEBI_BUCKET_NAME}/${fileKey}`;
};
