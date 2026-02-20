import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { randomUUID } from 'node:crypto';
import { TMP_ROOT, VIDEOS_ROOT, buildPublicVideoUrl } from '../lib/storage.js';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-700)}`));
    });
  });
}

async function writeConcatFile(photoPaths, filePath) {
  const lines = [];

  photoPaths.forEach((photoPath) => {
    const escaped = photoPath.replaceAll("'", "'\\''");
    lines.push(`file '${escaped}'`);
    lines.push('duration 2.8');
  });

  if (photoPaths.length > 0) {
    const lastEscaped = photoPaths[photoPaths.length - 1].replaceAll("'", "'\\''");
    lines.push(`file '${lastEscaped}'`);
  }

  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

export async function renderTripVideo({ userId, tripId, curatedPhotos }) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary unavailable');
  }

  const photoPaths = curatedPhotos.map((photo) => photo.absolutePath).filter(Boolean);

  if (!photoPaths.length) {
    throw new Error('No curated photo files available for video rendering');
  }

  const userDir = path.join(VIDEOS_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });

  const tmpListPath = path.join(TMP_ROOT, `frames_${tripId}_${randomUUID()}.txt`);
  const outputName = `${tripId}.mp4`;
  const outputPath = path.join(userDir, outputName);

  await writeConcatFile(photoPaths, tmpListPath);

  const args = [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    tmpListPath,
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    outputPath
  ];

  try {
    await runFfmpeg(args);
  } finally {
    await fs.rm(tmpListPath, { force: true });
  }

  const relativePath = `${userId}/${outputName}`;

  return {
    outputPath,
    videoUrl: buildPublicVideoUrl(relativePath)
  };
}
