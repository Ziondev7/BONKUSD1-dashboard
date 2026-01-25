declare module 'gifshot' {
  interface GifShotOptions {
    images?: string[]
    video?: string | string[]
    gifWidth?: number
    gifHeight?: number
    interval?: number
    numFrames?: number
    frameDuration?: number
    sampleInterval?: number
    numWorkers?: number
    progressCallback?: (progress: number) => void
    text?: string
    fontWeight?: string
    fontSize?: string
    fontFamily?: string
    fontColor?: string
    textAlign?: string
    textBaseline?: string
    waterMark?: string
    waterMarkHeight?: number
    waterMarkWidth?: number
    waterMarkXCoordinate?: number
    waterMarkYCoordinate?: number
  }

  interface GifShotResult {
    error: boolean
    errorCode?: string
    errorMsg?: string
    image: string
  }

  function createGIF(
    options: GifShotOptions,
    callback: (result: GifShotResult) => void
  ): void

  function takeSnapShot(
    options: GifShotOptions,
    callback: (result: GifShotResult) => void
  ): void

  function isSupported(): boolean
  function isWebCamGIFSupported(): boolean
  function isExistingImagesGIFSupported(): boolean
  function isExistingVideoGIFSupported(): boolean

  export {
    createGIF,
    takeSnapShot,
    isSupported,
    isWebCamGIFSupported,
    isExistingImagesGIFSupported,
    isExistingVideoGIFSupported,
    GifShotOptions,
    GifShotResult,
  }
}
