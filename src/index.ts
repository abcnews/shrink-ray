import { basename, dirname, join } from 'path';
const ffmpeg = require('fluent-ffmpeg');
const { generate } = require('shortid');
import tempy from 'tempy';
import { zip } from 'zip-a-folder';

ffmpeg.setFfmpegPath(
  require('@ffmpeg-installer/ffmpeg').path.replace(
    'app.asar',
    'app.asar.unpacked'
  )
);

ffmpeg.setFfprobePath(
  require('@ffprobe-installer/ffprobe').path.replace(
    'app.asar',
    'app.asar.unpacked'
  )
);

interface FiltersOfAspectRatios {
  [key: string]: any[];
}

interface Stream {
  height: number;
  nb_frames: number;
  r_frame_rate: string;
  width: number;
}

interface Metadata {
  streams: Stream[];
}

interface Progress {
  currentFps: number;
  frames: number;
  percent: number;
  timemark: string;
}

type Logger = (message: string) => void;

interface ShrinkRayOptions {
  logger?: Logger | boolean;
  onProgress?: (progress: Progress) => void;
}

const SHARED_OPTIONS = [
  '-y',
  '-movflags',
  'faststart',
  '-profile:v high',
  '-level:v 4.1',
  '-crf',
  '23',
  '-preset',
  'veryslow',
  '-an',
];

const FILE_EXTENSION_PATTERN = /\.\w+$/i;

const ASPECT_RATIO_FILTERS: FiltersOfAspectRatios = {
  '16x9': ['crop=in_w:in_w*min(in_w/in_h\\,in_h/in_w)'],
  '1x1': ['crop=min(in_h\\,in_w):min(in_h\\,in_w)'],
};

function probe(file: string) {
  return new Promise<Metadata>((resolve, reject) => {
    ffmpeg.ffprobe(file, (err: Error, metadata: Metadata) => {
      if (err) {
        return reject(err);
      }

      resolve(metadata);
    });
  });
}

const noop: Logger = () => {};

export default async function shrinkRay(
  file: string,
  options?: ShrinkRayOptions
) {
  let { logger, onProgress } = options || {};

  logger =
    logger === false ? noop : !logger || logger === true ? console.log : logger;

  try {
    await probe(file);
  } catch (e) {
    console.log(e);
    const msg = e.stderr || JSON.parse(e.stdout).error.string;

    console.error(new Error(msg));
    return process.exit(1);
  }

  const fileBase = basename(file);
  const fileDir = dirname(file);
  const projectId = generate();
  const projectName = fileBase.replace(FILE_EXTENSION_PATTERN, `_${projectId}`);
  const tempDir = tempy.directory();
  const zipFilePath = join(fileDir, `${projectName}.zip`);

  try {
    await new Promise<void | Error>((resolve, reject) => {
      let command = ffmpeg(file)
        .on('progress', (progress: Progress) => {
          if (onProgress) {
            onProgress(progress);
          }
        })
        .on('end', () => resolve())
        .on('error', reject)
        .videoBitrate('1024k')
        .videoCodec('libx264')
        .outputOptions(SHARED_OPTIONS);

      Object.keys(ASPECT_RATIO_FILTERS).forEach(aspectRatio => {
        const outputFileBase = fileBase.replace(
          FILE_EXTENSION_PATTERN,
          `_${[projectId, aspectRatio, 'mp4'].join('.')}`
        );

        command = command
          .output(join(tempDir, outputFileBase))
          .videoFilters(ASPECT_RATIO_FILTERS[aspectRatio]);
      });

      command.run();
    });
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }

  await zip(tempDir, zipFilePath);

  logger(`Created ${zipFilePath}`);

  return zipFilePath;
}
