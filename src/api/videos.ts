import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { S3Client, type BunRequest } from 'bun'

import { type ApiConfig } from '../config'
import { respondWithJSON } from './json'
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors'
import { getBearerToken, validateJWT } from '../auth'
import { getVideo, updateVideo } from '../db/videos'

const MAX_UPLOAD_SIZE = 1 << 30

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string }
  if (!videoId) {
    throw new BadRequestError('Invalid video ID')
  }

  const token = getBearerToken(req.headers)
  const userID = validateJWT(token, cfg.jwtSecret)

  console.log('uploading video for video', videoId, 'by user', userID)

  const video = getVideo(cfg.db, videoId)
  if (!video) {
    throw new NotFoundError('Video not found')
  }

  if (userID !== video.userID) {
    throw new UserForbiddenError('Video not owned by this user')
  }

  const formData = await req.formData()
  const file = formData.get('video')
  if (!(file instanceof File)) {
    throw new BadRequestError('Video file missing')
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Video exceeded file size limit')
  }

  if (file.type !== 'video/mp4') {
    throw new BadRequestError('Unsupported mime type')
  }

  const videoArrayBuffer = await file.arrayBuffer()
  let videoFileName = randomBytes(32).toString('base64url') + '.' + file.type.split('/')[1]
  const videoPath = path.join(cfg.assetsRoot, videoFileName)
  // Store temporary file on disk
  await Bun.write(videoPath, videoArrayBuffer)
  const videoFile = Bun.file(videoPath)

  const aspectRatio = await getVideoAspectRatio(videoPath)
  videoFileName = aspectRatio + '/' + videoFileName

  await S3Client.file(videoFileName, { type: 'video/mp4' }).write(videoFile)
  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoFileName}`
  updateVideo(cfg.db, video)

  // Delete the temp file
  await Bun.file(videoPath).delete()

  return respondWithJSON(200, null)
}

async function getVideoAspectRatio(filePath: string) {
  const subprocess = Bun.spawn({
    cmd: ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const text = await readableStreamToText(subprocess.stdout)

  const exitCode = await subprocess.exited

  if (exitCode !== 0) {
    throw new Error(`ffprobe exited with status ${exitCode}`)
  }

  try {
    const data = JSON.parse(text)
    const width = data.streams[0].width
    const height = data.streams[0].height

    // Calculate the greatest common divisor to simplify the aspect ratio
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    const divisor = gcd(width, height)

    // Calculate the aspect ratio as a floating-point number
    const simplifiedWidth = width / divisor
    const simplifiedHeight = height / divisor
    const aspectRatio = simplifiedWidth / simplifiedHeight

    const tolerance = 0.01

    if (Math.abs(aspectRatio - 16 / 9) < tolerance) {
      return 'landscape'
    } else if (Math.abs(aspectRatio - 9 / 16) < tolerance) {
      return 'portrait'
    } else {
      return 'other'
    }
  } catch (error) {
    console.error('Error parsing ffprobe output:', error)
    return null
  }
}

async function readableStreamToText(readableStream: ReadableStream) {
  const reader = readableStream.getReader()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
  }

  return text
}

function processVideoForFastStart(inputFilePath: string) {
  // TODO: Implement processing video for fast start
}
