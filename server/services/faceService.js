import {
  CreateCollectionCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesByImageCommand
} from '@aws-sdk/client-rekognition';

function buildCollectionId(userId) {
  return `travel-memory-${userId}`.slice(0, 64);
}

function getRekognitionClient() {
  if ((process.env.FACE_PROVIDER || '').toLowerCase() !== 'aws-rekognition') {
    return null;
  }

  if (!process.env.AWS_REGION) {
    return null;
  }

  return new RekognitionClient({
    region: process.env.AWS_REGION,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
          }
        : undefined
  });
}

export function createFaceService() {
  const client = getRekognitionClient();

  if (!client) {
    return {
      enabled: false,
      async analyzePhoto() {
        return { recognizedFaceIds: [] };
      }
    };
  }

  const collectionReady = new Set();

  async function ensureCollection(userId) {
    const collectionId = buildCollectionId(userId);
    if (collectionReady.has(collectionId)) {
      return collectionId;
    }

    try {
      await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
    } catch (error) {
      if (error?.name !== 'ResourceAlreadyExistsException') {
        throw error;
      }
    }

    collectionReady.add(collectionId);
    return collectionId;
  }

  return {
    enabled: true,

    async analyzePhoto({ userId, bytes, externalImageId }) {
      const collectionId = await ensureCollection(userId);

      let recognizedFaceIds = [];

      try {
        const searchResp = await client.send(
          new SearchFacesByImageCommand({
            CollectionId: collectionId,
            Image: { Bytes: bytes },
            FaceMatchThreshold: 92,
            MaxFaces: 5
          })
        );

        recognizedFaceIds = (searchResp.FaceMatches || [])
          .map((match) => match?.Face?.FaceId)
          .filter(Boolean);
      } catch {
        recognizedFaceIds = [];
      }

      if (!recognizedFaceIds.length) {
        try {
          const indexResp = await client.send(
            new IndexFacesCommand({
              CollectionId: collectionId,
              Image: { Bytes: bytes },
              ExternalImageId: externalImageId || userId,
              MaxFaces: 5,
              QualityFilter: 'AUTO',
              DetectionAttributes: []
            })
          );

          recognizedFaceIds = (indexResp.FaceRecords || [])
            .map((record) => record?.Face?.FaceId)
            .filter(Boolean);
        } catch {
          recognizedFaceIds = [];
        }
      }

      return { recognizedFaceIds };
    }
  };
}
