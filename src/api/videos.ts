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
  const videoFileName = randomBytes(32).toString('base64url') + '.' + file.type.split('/')[1]
  const videoPath = path.join(cfg.assetsRoot, videoFileName)
  // Store temporary file on disk
  await Bun.write(videoPath, videoArrayBuffer)
  const videoFile = Bun.file(videoPath)

  await S3Client.file(videoFileName, { type: 'video/mp4' }).write(videoFile)
  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoFileName}`
  updateVideo(cfg.db, video)

  // Delete the temp file
  await Bun.file(videoPath).delete()

  return respondWithJSON(200, null)
}
