import { getBearerToken, validateJWT } from '../auth'
import { respondWithJSON } from './json'
import { getVideo, updateVideo } from '../db/videos'
import type { ApiConfig } from '../config'
import type { BunRequest } from 'bun'
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors'

const MAX_UPLOAD_SIZE = 10 << 20

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string }
  if (!videoId) {
    throw new BadRequestError('Invalid video ID')
  }

  const token = getBearerToken(req.headers)
  const userID = validateJWT(token, cfg.jwtSecret)

  console.log('uploading thumbnail for video', videoId, 'by user', userID)

  const formData = await req.formData()
  const file = formData.get('thumbnail')
  if (!(file instanceof File)) {
    throw new BadRequestError('Thumbnail file missing')
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Thumbnail exceeded file size limit')
  }
  const imgArrayBuffer = await file.arrayBuffer()
  const stringedImgBuffer = Buffer.from(imgArrayBuffer).toString('base64')
  const dataUrl = `data:${file.type};base64,${stringedImgBuffer}`

  const video = getVideo(cfg.db, videoId)
  if (!video) {
    throw new NotFoundError('Video not found')
  }

  if (userID !== video.userID) {
    throw new UserForbiddenError('Video not owned by this user')
  }

  video.thumbnailURL = dataUrl
  updateVideo(cfg.db, video)

  return respondWithJSON(200, video)
}
