import { S3 } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { randomUUID } from "crypto";

// Validate environment variables on module load
const validateEnvVars = () => {
  const required = [
    'TEBI_ENDPOINT',
    'TEBI_REGION', 
    'TEBI_ACCESS_KEY',
    'TEBI_SECRET_KEY',
    'TEBI_BUCKET_NAME'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

// Validate on startup
validateEnvVars();

const s3 = new S3({
  endpoint: process.env.TEBI_ENDPOINT as string,
  region: process.env.TEBI_REGION as string,
  credentials: {
    accessKeyId: process.env.TEBI_ACCESS_KEY as string,
    secretAccessKey: process.env.TEBI_SECRET_KEY as string,
  },
  forcePathStyle: true,
});

interface UploadOptions {
  makePublic?: boolean;
  folder?: string;
  maxFileSize?: number; // in bytes
  allowedMimeTypes?: string[];
}

const defaultOptions: UploadOptions = {
  makePublic: false, // Secure by default
  folder: 'documents',
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv'
  ]
};

// Sanitize filename more thoroughly
const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .toLowerCase();
};

// Generate unique file key
const generateFileKey = (originalName: string, folder: string): string => {
  const sanitized = sanitizeFilename(originalName);
  const uuid = randomUUID();
  const timestamp = Date.now();
  
  // Use UUID to prevent conflicts, timestamp for chronological ordering
  return `${folder}/${timestamp}-${uuid}-${sanitized}`;
};

export const uploadToTebiStorage = async (
  file: Express.Multer.File,
  options: UploadOptions = {}
): Promise<{ url: string; key: string; size: number }> => {
  try {
    const config = { ...defaultOptions, ...options };

    // Validate file
    if (!file) {
      throw new Error("No file provided");
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new Error("File is empty");
    }

    if (file.size > config.maxFileSize!) {
      throw new Error(`File too large. Maximum size is ${config.maxFileSize! / 1024 / 1024}MB`);
    }

    if (config.allowedMimeTypes && !config.allowedMimeTypes.includes(file.mimetype)) {
      throw new Error(`File type not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}`);
    }

    // Generate unique file key
    const fileKey = generateFileKey(file.originalname, config.folder!);

    // Prepare upload parameters
    const uploadParams = {
      Bucket: process.env.TEBI_BUCKET_NAME as string,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentLength: file.size,
      // Only set ACL if making public
      ...(config.makePublic && { ACL: "public-read" as const }),
      // Add metadata
      Metadata: {
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
        fileSize: file.size.toString()
      }
    };

    const upload = new Upload({
      client: s3,
      params: uploadParams,
    });

    // Handle upload progress (optional)
    upload.on("httpUploadProgress", (progress) => {
      if (progress.total) {
        const percentage = Math.round((progress.loaded! / progress.total) * 100);
        console.log(`Upload progress: ${percentage}%`);
      }
    });

    const result = await upload.done();
    
    // Verify upload succeeded
    if (!result.Location && !result.Key) {
      throw new Error("Upload completed but no location returned");
    }

    // Construct URL
    const url = config.makePublic 
      ? `${process.env.TEBI_ENDPOINT}/${process.env.TEBI_BUCKET_NAME}/${fileKey}`
      : `s3://${process.env.TEBI_BUCKET_NAME}/${fileKey}`; // Private S3 URI

    return {
      url,
      key: fileKey,
      size: file.size
    };

  } catch (error: any) {
    console.error("Error uploading to Tebi Storage:", error.message);
    
    // Provide specific error messages
    if (error.name === 'NoSuchBucket') {
      throw new Error("Storage bucket not found. Please check configuration.");
    }
    
    if (error.name === 'InvalidAccessKeyId') {
      throw new Error("Invalid storage credentials. Please check access key.");
    }
    
    if (error.name === 'SignatureDoesNotMatch') {
      throw new Error("Invalid storage credentials. Please check secret key.");
    }

    if (error.message?.includes('File too large') || error.message?.includes('File type not allowed')) {
      throw error; // Re-throw validation errors as-is
    }

    throw new Error(`Failed to upload file: ${error.message}`);
  }
};

// Utility function to delete files
export const deleteFromTebiStorage = async (fileKey: string): Promise<void> => {
  try {
    await s3.deleteObject({
      Bucket: process.env.TEBI_BUCKET_NAME as string,
      Key: fileKey,
    });
  } catch (error: any) {
    console.error("Error deleting from Tebi Storage:", error.message);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

// Utility function to check if file exists
export const fileExists = async (fileKey: string): Promise<boolean> => {
  try {
    await s3.headObject({
      Bucket: process.env.TEBI_BUCKET_NAME as string,
      Key: fileKey,
    });
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
};

// Legacy function for backward compatibility
export const uploadToTebiStoragePublic = async (file: Express.Multer.File) => {
  const result = await uploadToTebiStorage(file, { makePublic: true });
  return result.url;
};